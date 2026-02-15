/**
 * GIT INTEGRATION SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Creates PRs for auto-generated tools and code modifications.
 * 
 * Security Model:
 * - All code changes go through PR review
 * - Never commits directly to main/master
 * - Requires GITHUB_TOKEN with 'repo' scope
 * 
 * Usage:
 * 1. Set GITHUB_TOKEN in environment
 * 2. Set GITHUB_REPO_OWNER and GITHUB_REPO_NAME
 */

import { backgroundLLM } from './backgroundLLMService';
import { DynamicTool } from './tools/toolRegistry';

interface GitHubConfig {
    token: string;
    owner: string;
    repo: string;
    baseBranch: string;
}

interface PRResult {
    success: boolean;
    prUrl?: string;
    prNumber?: number;
    branchName?: string;
    error?: string;
}

interface FileChange {
    path: string;
    content: string;
    message: string;
}

interface CIStatus {
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'pending' | 'in_progress';
    checkRuns: CheckRun[];
    allPassed: boolean;
}

interface CheckRun {
    name: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: string | null;
    output?: {
        title: string;
        summary: string;
        text?: string;
    };
}

interface CIVerificationResult {
    passed: boolean;
    attempts: number;
    maxAttempts: number;
    lastError?: string;
    checkRuns: CheckRun[];
}

class GitIntegration {
    private static instance: GitIntegration;
    private config: GitHubConfig | null = null;
    private apiBase = 'https://api.github.com';

    private constructor() {
        this.loadConfig();
    }

    public static getInstance(): GitIntegration {
        if (!GitIntegration.instance) {
            GitIntegration.instance = new GitIntegration();
        }
        return GitIntegration.instance;
    }

    private loadConfig(): void {
        const token = process.env.GITHUB_TOKEN || '';
        const owner = process.env.GITHUB_REPO_OWNER || '';
        const repo = process.env.GITHUB_REPO_NAME || 'Silhouette-Agency-OS';
        const baseBranch = process.env.GITHUB_BASE_BRANCH || 'main';

        if (token && owner) {
            this.config = { token, owner, repo, baseBranch };
            console.log(`[GIT_INTEGRATION] ✅ Configured for ${owner}/${repo}`);
        } else {
            console.warn('[GIT_INTEGRATION] ⚠️ Not configured. Set GITHUB_TOKEN and GITHUB_REPO_OWNER');
        }
    }

    /**
     * Check if Git integration is available
     */
    public isAvailable(): boolean {
        return this.config !== null && !!this.config.token;
    }

    /**
     * Create a PR for a new dynamically generated tool
     */
    public async createToolPR(tool: DynamicTool): Promise<PRResult> {
        if (!this.isAvailable()) {
            return { success: false, error: 'Git integration not configured' };
        }

        console.log(`[GIT_INTEGRATION] 🔧 Creating PR for tool: ${tool.name}`);

        try {
            // 1. Generate tool code
            const toolCode = await this.generateToolCode(tool);

            // 2. Create branch name
            const branchName = `silhouette/tool-${tool.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}`;

            // 3. Create the file change
            const filePath = `services/tools/generated/${tool.name}.ts`;

            // 4. Create PR
            const result = await this.createPR({
                title: `🤖 [Auto] New Tool: ${tool.name}`,
                body: this.generatePRBody(tool),
                branchName,
                files: [{
                    path: filePath,
                    content: toolCode,
                    message: `Add auto-generated tool: ${tool.name}`
                }]
            });

            return result;

        } catch (error: any) {
            console.error('[GIT_INTEGRATION] ❌ Failed to create tool PR:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate TypeScript code for a tool
     */
    private async generateToolCode(tool: DynamicTool): Promise<string> {
        const prompt = `Generate TypeScript code for this tool:

Name: ${tool.name}
Description: ${tool.description}
Category: ${tool.category}
Handler Type: ${tool.handler.type}
Parameters: ${JSON.stringify(tool.parameters, null, 2)}

Requirements:
1. Export a default object with name and handler
2. Include proper TypeScript types
3. Add JSDoc comments
4. Include error handling
5. Make it production-ready

Generate ONLY the TypeScript code, no markdown.`;

        const code = await backgroundLLM.generateCode(
            prompt,
            `Tool: ${tool.name}`,
            'TypeScript'
        );

        // Wrap with header if not already formatted
        if (!code.includes('AUTO-GENERATED')) {
            return `/**
 * AUTO-GENERATED TOOL: ${tool.name}
 * Created: ${new Date().toISOString()}
 * Category: ${tool.category}
 * 
 * DO NOT EDIT DIRECTLY - This file was auto-generated by Silhouette
 */

${code}
`;
        }

        return code;
    }

    /**
     * Generate PR body with review checklist
     */
    private generatePRBody(tool: DynamicTool): string {
        return `## 🤖 Auto-Generated Tool

**Name**: \`${tool.name}\`
**Category**: ${tool.category}
**Created By**: Silhouette AI Self-Evolution System

### Description
${tool.description}

### Parameters
\`\`\`json
${JSON.stringify(tool.parameters, null, 2)}
\`\`\`

### Handler Type
\`${tool.handler.type}\`

---

### Review Checklist
- [ ] Code is safe and follows best practices
- [ ] No security vulnerabilities
- [ ] Proper error handling
- [ ] TypeScript types are correct
- [ ] Tool integrates correctly with existing system

### Auto-Generated
> ⚠️ This PR was automatically created by Silhouette's self-evolution system.
> Please review carefully before merging.
`;
    }

    /**
     * Create a PR with file changes (simplified - uses GitHub API)
     */
    public async createPR(options: {
        title: string;
        body: string;
        branchName: string;
        files: FileChange[];
    }): Promise<PRResult> {
        if (!this.config) {
            return { success: false, error: 'Not configured' };
        }

        const { owner, repo, token, baseBranch } = this.config;

        try {
            // 1. Get base branch SHA
            const baseRef = await this.githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
            const baseSha = baseRef.object.sha;

            // 2. Create new branch
            await this.githubRequest(`/repos/${owner}/${repo}/git/refs`, 'POST', {
                ref: `refs/heads/${options.branchName}`,
                sha: baseSha
            });

            // 3. Create/update files
            for (const file of options.files) {
                await this.githubRequest(`/repos/${owner}/${repo}/contents/${file.path}`, 'PUT', {
                    message: file.message,
                    content: Buffer.from(file.content).toString('base64'),
                    branch: options.branchName
                });
            }

            // 4. Create PR
            const pr = await this.githubRequest(`/repos/${owner}/${repo}/pulls`, 'POST', {
                title: options.title,
                body: options.body,
                head: options.branchName,
                base: baseBranch
            });

            console.log(`[GIT_INTEGRATION] ✅ PR created: ${pr.html_url}`);

            return {
                success: true,
                prUrl: pr.html_url,
                prNumber: pr.number,
                branchName: options.branchName
            };

        } catch (error: any) {
            console.error('[GIT_INTEGRATION] GitHub API error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Make GitHub API request
     */
    private async githubRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
        if (!this.config) {
            throw new Error('Not configured');
        }

        const response = await fetch(`${this.apiBase}${endpoint}`, {
            method,
            headers: {
                'Authorization': `Bearer ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`GitHub API ${response.status}: ${error}`);
        }

        return response.json();
    }

    /**
     * Get configuration status
     */
    public getStatus(): {
        configured: boolean;
        owner?: string;
        repo?: string;
    } {
        if (!this.config) {
            return { configured: false };
        }

        return {
            configured: true,
            owner: this.config.owner,
            repo: this.config.repo
        };
    }

    /**
     * Get CI status for a PR
     */
    public async getCIStatus(prNumber: number): Promise<CIStatus | null> {
        if (!this.config) return null;

        const { owner, repo } = this.config;

        try {
            // Get the PR to find the head SHA
            const pr = await this.githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);
            const headSha = pr.head.sha;

            // Get check runs for this commit
            const checks = await this.githubRequest(`/repos/${owner}/${repo}/commits/${headSha}/check-runs`);

            const checkRuns: CheckRun[] = checks.check_runs.map((run: any) => ({
                name: run.name,
                status: run.status,
                conclusion: run.conclusion,
                output: run.output ? {
                    title: run.output.title || '',
                    summary: run.output.summary || '',
                    text: run.output.text
                } : undefined
            }));

            // Determine overall status
            const allCompleted = checkRuns.every(run => run.status === 'completed');
            const allPassed = checkRuns.every(run =>
                run.status === 'completed' &&
                (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped')
            );
            const anyFailed = checkRuns.some(run =>
                run.status === 'completed' && run.conclusion === 'failure'
            );

            let conclusion: CIStatus['conclusion'] = 'pending';
            if (allCompleted) {
                conclusion = allPassed ? 'success' : 'failure';
            } else if (checkRuns.some(run => run.status === 'in_progress')) {
                conclusion = 'in_progress';
            }

            return {
                conclusion,
                checkRuns,
                allPassed
            };
        } catch (error: any) {
            console.error('[GIT_INTEGRATION] Error getting CI status:', error.message);
            return null;
        }
    }

    /**
     * Wait for CI to complete with polling
     */
    public async waitForCI(prNumber: number, timeoutMs: number = 300000, pollIntervalMs: number = 15000): Promise<CIStatus | null> {
        if (!this.config) return null;

        const startTime = Date.now();
        console.log(`[GIT_INTEGRATION] ⏳ Waiting for CI on PR #${prNumber}...`);

        while (Date.now() - startTime < timeoutMs) {
            const status = await this.getCIStatus(prNumber);

            if (status && (status.conclusion === 'success' || status.conclusion === 'failure')) {
                console.log(`[GIT_INTEGRATION] ${status.allPassed ? '✅' : '❌'} CI completed: ${status.conclusion}`);
                return status;
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        console.warn('[GIT_INTEGRATION] ⚠️ CI timeout reached');
        return null;
    }

    /**
     * Convert a draft PR to ready for review
     */
    public async markReadyForReview(prNumber: number): Promise<boolean> {
        if (!this.config) return false;

        const { owner, repo } = this.config;

        try {
            // Use GraphQL API for this operation
            const query = `
                mutation($prId: ID!) {
                    markPullRequestReadyForReview(input: { pullRequestId: $prId }) {
                        pullRequest { isDraft }
                    }
                }
            `;

            // First get the node ID of the PR
            const pr = await this.githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`);

            // Make GraphQL request
            const response = await fetch('https://api.github.com/graphql', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query,
                    variables: { prId: pr.node_id }
                })
            });

            const result = await response.json();

            if (result.errors) {
                throw new Error(result.errors[0].message);
            }

            console.log(`[GIT_INTEGRATION] ✅ PR #${prNumber} marked as ready for review`);
            return true;
        } catch (error: any) {
            console.error('[GIT_INTEGRATION] Error marking PR ready:', error.message);
            return false;
        }
    }

    /**
     * Push additional commits to an existing PR branch
     */
    public async pushFixToBranch(branchName: string, files: FileChange[]): Promise<boolean> {
        if (!this.config) return false;

        const { owner, repo } = this.config;

        try {
            for (const file of files) {
                // Get current file SHA if it exists
                let currentSha: string | undefined;
                try {
                    const existing = await this.githubRequest(
                        `/repos/${owner}/${repo}/contents/${file.path}?ref=${branchName}`
                    );
                    currentSha = existing.sha;
                } catch {
                    // File doesn't exist, that's fine
                }

                await this.githubRequest(`/repos/${owner}/${repo}/contents/${file.path}`, 'PUT', {
                    message: `🔧 Auto-fix: ${file.message}`,
                    content: Buffer.from(file.content).toString('base64'),
                    branch: branchName,
                    sha: currentSha
                });
            }

            console.log(`[GIT_INTEGRATION] ✅ Pushed ${files.length} file(s) to ${branchName}`);
            return true;
        } catch (error: any) {
            console.error('[GIT_INTEGRATION] Error pushing fix:', error.message);
            return false;
        }
    }

    /**
     * Get CI error logs for auto-correction
     */
    public async getCIErrors(prNumber: number): Promise<string[]> {
        const status = await this.getCIStatus(prNumber);
        if (!status) return [];

        const errors: string[] = [];
        for (const run of status.checkRuns) {
            if (run.conclusion === 'failure' && run.output?.text) {
                errors.push(`[${run.name}]: ${run.output.text.substring(0, 2000)}`);
            } else if (run.conclusion === 'failure' && run.output?.summary) {
                errors.push(`[${run.name}]: ${run.output.summary}`);
            }
        }

        return errors;
    }

    /**
     * Full CI verification flow with auto-correction
     * This is the main entry point for safe self-modification
     */
    public async verifyWithAutoCorrection(
        prNumber: number,
        branchName: string,
        maxAttempts: number = 3,
        onAttemptFix?: (errors: string[], attempt: number) => Promise<FileChange[] | null>
    ): Promise<CIVerificationResult> {
        let attempts = 0;
        let lastError: string | undefined;

        while (attempts < maxAttempts) {
            attempts++;
            console.log(`[GIT_INTEGRATION] 🔄 CI Verification attempt ${attempts}/${maxAttempts}`);

            // Wait for CI to complete
            const status = await this.waitForCI(prNumber);

            if (!status) {
                lastError = 'CI timeout or unreachable';
                continue;
            }

            if (status.allPassed) {
                // Success! Mark PR as ready for review
                await this.markReadyForReview(prNumber);
                return {
                    passed: true,
                    attempts,
                    maxAttempts,
                    checkRuns: status.checkRuns
                };
            }

            // CI failed - attempt auto-correction
            if (attempts < maxAttempts && onAttemptFix) {
                const errors = await this.getCIErrors(prNumber);
                lastError = errors.join('\n');

                console.log(`[GIT_INTEGRATION] 🔧 Attempting auto-fix for ${errors.length} error(s)...`);

                const fixes = await onAttemptFix(errors, attempts);
                if (fixes && fixes.length > 0) {
                    await this.pushFixToBranch(branchName, fixes);
                    // Loop continues to check CI again
                } else {
                    console.log('[GIT_INTEGRATION] ⚠️ No auto-fix available');
                    break;
                }
            } else {
                lastError = 'Max attempts reached or no fix handler';
                break;
            }
        }

        return {
            passed: false,
            attempts,
            maxAttempts,
            lastError,
            checkRuns: []
        };
    }
}

export const gitIntegration = GitIntegration.getInstance();
