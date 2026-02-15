/**
 * AUTO-CORRECTION SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Uses LLM to analyze CI errors and generate code fixes.
 * 
 * This service enables Silhouette to:
 * 1. Parse CI error logs
 * 2. Identify the problematic code
 * 3. Generate fixes using background LLM
 * 4. Push corrections to the PR branch
 */

import { backgroundLLM } from './backgroundLLMService';
import { gitIntegration } from './gitIntegration';

interface CIError {
    checkName: string;
    errorType: 'typecheck' | 'lint' | 'build' | 'test' | 'unknown';
    message: string;
    file?: string;
    line?: number;
    column?: number;
}

interface FixResult {
    success: boolean;
    filePath: string;
    originalContent?: string;
    fixedContent?: string;
    explanation?: string;
}

class AutoCorrectionService {
    private static instance: AutoCorrectionService;

    private constructor() { }

    public static getInstance(): AutoCorrectionService {
        if (!AutoCorrectionService.instance) {
            AutoCorrectionService.instance = new AutoCorrectionService();
        }
        return AutoCorrectionService.instance;
    }

    /**
     * Parse CI error logs into structured errors
     */
    public parseErrors(errorLogs: string[]): CIError[] {
        const errors: CIError[] = [];

        for (const log of errorLogs) {
            // Extract check name from log format: [CheckName]: message
            const checkMatch = log.match(/^\[([^\]]+)\]:\s*(.*)/s);
            if (!checkMatch) continue;

            const checkName = checkMatch[1];
            const message = checkMatch[2];

            // Determine error type
            let errorType: CIError['errorType'] = 'unknown';
            if (checkName.toLowerCase().includes('typescript') || checkName.toLowerCase().includes('typecheck')) {
                errorType = 'typecheck';
            } else if (checkName.toLowerCase().includes('lint') || checkName.toLowerCase().includes('eslint')) {
                errorType = 'lint';
            } else if (checkName.toLowerCase().includes('build')) {
                errorType = 'build';
            } else if (checkName.toLowerCase().includes('test')) {
                errorType = 'test';
            }

            // Try to extract file location
            // Common patterns: file.ts(line,col), file.ts:line:col, file.ts line X
            const locationPatterns = [
                /([^\s]+\.[jt]sx?)\((\d+),(\d+)\)/,  // file.ts(1,5)
                /([^\s]+\.[jt]sx?):(\d+):(\d+)/,     // file.ts:1:5
                /([^\s]+\.[jt]sx?)\s+line\s+(\d+)/i, // file.ts line 1
            ];

            let file: string | undefined;
            let line: number | undefined;
            let column: number | undefined;

            for (const pattern of locationPatterns) {
                const match = message.match(pattern);
                if (match) {
                    file = match[1];
                    line = parseInt(match[2], 10);
                    column = match[3] ? parseInt(match[3], 10) : undefined;
                    break;
                }
            }

            errors.push({
                checkName,
                errorType,
                message,
                file,
                line,
                column
            });
        }

        return errors;
    }

    /**
     * Generate a fix for a specific error using LLM
     */
    public async generateFix(error: CIError, fileContent?: string): Promise<FixResult | null> {
        const prompt = `You are fixing a CI error. Analyze and provide the corrected code.

ERROR TYPE: ${error.errorType}
CHECK: ${error.checkName}
${error.file ? `FILE: ${error.file}` : ''}
${error.line ? `LINE: ${error.line}` : ''}

ERROR MESSAGE:
${error.message}

${fileContent ? `CURRENT FILE CONTENT:
\`\`\`
${fileContent}
\`\`\`
` : ''}

TASK: Provide the FIXED version of the problematic code section.

RESPONSE FORMAT (JSON):
{
    "explanation": "Brief explanation of the fix",
    "fixedCode": "The corrected code section",
    "startLine": <number or null if replacing whole file>,
    "endLine": <number or null>
}

Only output valid JSON. No markdown.`;

        try {
            const response = await backgroundLLM.generateCode(
                prompt,
                `Fix: ${error.checkName}`,
                'JSON'
            );

            // Parse response with robust JSON extraction
            const cleanJson = response
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();

            let parsed: { fixedCode?: string; explanation?: string };
            try {
                parsed = JSON.parse(cleanJson);
            } catch (parseError) {
                // Attempt to extract JSON from mixed content
                const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No valid JSON found in response');
                }
            }

            return {
                success: true,
                filePath: error.file || 'unknown',
                fixedContent: parsed.fixedCode,
                explanation: parsed.explanation
            };
        } catch (e: any) {
            console.error('[AUTO_CORRECTION] Failed to generate fix:', e.message);
            return null;
        }
    }

    /**
     * Generate fixes for multiple errors
     */
    public async generateFixes(
        errorLogs: string[],
        attempt: number
    ): Promise<{ path: string; content: string; message: string; }[] | null> {
        const errors = this.parseErrors(errorLogs);

        if (errors.length === 0) {
            console.log('[AUTO_CORRECTION] No parseable errors found');
            return null;
        }

        console.log(`[AUTO_CORRECTION] Parsed ${errors.length} error(s), attempting fixes...`);

        const fixes: { path: string; content: string; message: string; }[] = [];

        // Group errors by file, track orphans separately
        const errorsByFile = new Map<string, CIError[]>();
        const orphanErrors: CIError[] = [];

        for (const error of errors) {
            if (error.file) {
                const existing = errorsByFile.get(error.file) || [];
                existing.push(error);
                errorsByFile.set(error.file, existing);
            } else {
                orphanErrors.push(error);
            }
        }

        // Log orphan errors for manual review (config/dependency issues)
        if (orphanErrors.length > 0) {
            console.warn(`[AUTO_CORRECTION] ⚠️ ${orphanErrors.length} error(s) without file location:`);
            orphanErrors.forEach(e => console.warn(`  - [${e.checkName}]: ${e.message.substring(0, 100)}...`));
        }

        // Generate fix for each file (limit to prevent infinite loops)
        const maxFilesToFix = 3;
        let filesFixed = 0;

        for (const [file, fileErrors] of errorsByFile) {
            if (filesFixed >= maxFilesToFix) break;

            // Get current file content from GitHub
            const content = await this.getFileContent(file);

            // Combine all errors for this file into one prompt
            // Determine dominant error type with priority: typecheck > build > lint > test > unknown
            const typePriority: CIError['errorType'][] = ['typecheck', 'build', 'lint', 'test', 'unknown'];
            const dominantType = typePriority.find(t => fileErrors.some(e => e.errorType === t)) || 'unknown';

            const combinedError: CIError = {
                checkName: fileErrors.map(e => e.checkName).join(', '),
                errorType: dominantType,
                message: fileErrors.map(e => `[${e.errorType.toUpperCase()}] ${e.message}`).join('\n\n---\n\n'),
                file
            };

            const fix = await this.generateFix(combinedError, content);

            if (fix && fix.fixedContent) {
                fixes.push({
                    path: file,
                    content: fix.fixedContent,
                    message: fix.explanation || `Auto-fix for ${combinedError.checkName}`
                });
                filesFixed++;
            }
        }

        return fixes.length > 0 ? fixes : null;
    }

    /**
     * Get file content from GitHub repository
     */
    private async getFileContent(filePath: string): Promise<string | undefined> {
        try {
            const status = gitIntegration.getStatus();
            if (!status.configured || !status.owner || !status.repo) {
                return undefined;
            }

            // Use GitHub API to get file content
            const response = await fetch(
                `https://api.github.com/repos/${status.owner}/${status.repo}/contents/${filePath}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (!response.ok) return undefined;

            const data = await response.json();
            return Buffer.from(data.content, 'base64').toString('utf-8');
        } catch {
            return undefined;
        }
    }

    /**
     * Main entry point: Attempt to auto-correct a PR
     */
    public async attemptAutoCorrection(
        prNumber: number,
        branchName: string,
        maxAttempts: number = 3
    ): Promise<{ success: boolean; attempts: number; message: string }> {
        console.log(`[AUTO_CORRECTION] 🤖 Starting auto-correction for PR #${prNumber}`);

        const result = await gitIntegration.verifyWithAutoCorrection(
            prNumber,
            branchName,
            maxAttempts,
            async (errors: string[], attempt: number) => {
                console.log(`[AUTO_CORRECTION] Attempt ${attempt}: Processing ${errors.length} error(s)`);
                return await this.generateFixes(errors, attempt);
            }
        );

        if (result.passed) {
            return {
                success: true,
                attempts: result.attempts,
                message: `✅ CI passed after ${result.attempts} attempt(s). PR is ready for review.`
            };
        } else {
            return {
                success: false,
                attempts: result.attempts,
                message: `❌ CI failed after ${result.attempts} attempt(s). ${result.lastError || 'Manual review required.'}`
            };
        }
    }
}

export const autoCorrection = AutoCorrectionService.getInstance();
