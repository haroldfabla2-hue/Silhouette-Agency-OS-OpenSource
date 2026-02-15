/**
 * SECURITY SQUAD - Intelligent Code Review Before Execution
 * ═══════════════════════════════════════════════════════════════
 * Multi-layer security analysis for code execution requests.
 * 
 * ARCHITECTURE INTEGRATION:
 * This service leverages Silhouette's agent architecture:
 * - Delegates complex analysis to CYBERSEC category agents
 * - Uses orchestrator for dynamic agent creation/assignment
 * - Communicates results via SystemBus
 * 
 * Layers:
 * 1. Static Analysis - Pattern matching for dangerous operations
 * 2. Intent Verification - LLM/Agent validates code matches stated purpose
 * 3. Permission Check - Agent authorization verification
 * 4. Prompt Injection Detection - Verify code origin is trusted
 * 
 * Philosophy: Preserve autonomy while preventing catastrophic actions.
 */

import { systemBus } from '../systemBus';
import { geminiService } from '../geminiService';
import { SystemProtocol } from '../../types';

// ==================== INTERFACES ====================

export interface SecurityReview {
    approved: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    warnings: string[];
    blockedPatterns?: string[];
    modifications?: string;  // Sanitized version if applicable
    analysisDetails: {
        staticAnalysis: boolean;
        intentVerification: boolean;
        permissionCheck: boolean;
        injectionCheck: boolean;
    };
    reviewTimeMs: number;
}

export interface CodeReviewRequest {
    code: string;
    language: 'javascript' | 'typescript' | 'python' | 'bash';
    statedPurpose: string;
    requesterId: string;
    traceId?: string;
}

// ==================== DANGEROUS PATTERNS ====================

const CRITICAL_PATTERNS: { pattern: RegExp; description: string; severity: 'HIGH' | 'CRITICAL' }[] = [
    // Filesystem destruction
    { pattern: /rm\s+-rf\s+[\/~]/, description: 'Delete root/home directory', severity: 'CRITICAL' },
    { pattern: /del\s+\/[sq]\s+[c-z]:/i, description: 'Windows delete root', severity: 'CRITICAL' },
    { pattern: /format\s+[c-z]:/i, description: 'Windows format drive', severity: 'CRITICAL' },
    { pattern: /mkfs\./i, description: 'Linux format filesystem', severity: 'CRITICAL' },
    { pattern: /dd\s+if=.*of=\/dev/i, description: 'Direct disk write', severity: 'CRITICAL' },

    // Fork bombs and resource exhaustion
    { pattern: /:(){ :\|:& };:/, description: 'Fork bomb', severity: 'CRITICAL' },
    { pattern: /while\s*\(\s*true\s*\)\s*{\s*fork/, description: 'Fork loop', severity: 'CRITICAL' },

    // Privilege escalation
    { pattern: /sudo\s+rm/i, description: 'Sudo delete', severity: 'CRITICAL' },
    { pattern: /chmod\s+-R\s+777\s+\//i, description: 'Dangerous permissions on root', severity: 'CRITICAL' },

    // Network exfiltration
    { pattern: /curl.*\|\s*(ba)?sh/i, description: 'Pipe remote script to shell', severity: 'CRITICAL' },
    { pattern: /wget.*\|\s*(ba)?sh/i, description: 'Pipe remote script to shell', severity: 'CRITICAL' },

    // Credential theft
    { pattern: /cat\s+.*\/etc\/(passwd|shadow)/i, description: 'Read password files', severity: 'HIGH' },
    { pattern: /\.env|API_KEY|SECRET|PASSWORD/i, description: 'Potential credential access', severity: 'HIGH' },

    // Python specific
    { pattern: /os\.system\s*\(\s*['\"]rm\s+-rf/i, description: 'Python exec rm -rf', severity: 'CRITICAL' },
    { pattern: /subprocess\.(call|run|Popen).*shell\s*=\s*True/i, description: 'Python shell injection risk', severity: 'HIGH' },
    { pattern: /eval\s*\(\s*input\s*\(/i, description: 'Eval user input', severity: 'CRITICAL' },

    // JavaScript specific
    { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, description: 'Node child_process import', severity: 'HIGH' },
    { pattern: /process\.env\.[A-Z_]*KEY/i, description: 'Access API keys from env', severity: 'HIGH' },
];

const SUSPICIOUS_PATTERNS: { pattern: RegExp; description: string }[] = [
    { pattern: /base64.*decode/i, description: 'Base64 decode (potential obfuscation)' },
    { pattern: /exec\s*\(/i, description: 'Dynamic code execution' },
    { pattern: /eval\s*\(/i, description: 'Eval statement' },
    { pattern: /\\x[0-9a-f]{2}/i, description: 'Hex-encoded strings' },
    { pattern: /\\u[0-9a-f]{4}/i, description: 'Unicode-encoded strings' },
    { pattern: /atob\s*\(/i, description: 'Base64 decode in JS' },
    { pattern: /Function\s*\(/i, description: 'Dynamic function creation' },
];

// ==================== SECURITY SQUAD ====================

class SecuritySquad {
    private static instance: SecuritySquad;
    private reviewCount: number = 0;
    private blockedCount: number = 0;

    private constructor() { }

    public static getInstance(): SecuritySquad {
        if (!SecuritySquad.instance) {
            SecuritySquad.instance = new SecuritySquad();
        }
        return SecuritySquad.instance;
    }

    /**
     * Review code before execution
     * Returns SecurityReview with approval status and risk level
     */
    public async reviewCode(request: CodeReviewRequest): Promise<SecurityReview> {
        const startTime = Date.now();
        this.reviewCount++;

        // Emit review request event
        systemBus.emit(SystemProtocol.SECURITY_REVIEW_REQUEST, {
            requesterId: request.requesterId,
            language: request.language,
            codeLength: request.code.length,
            traceId: request.traceId
        }, 'SecuritySquad');

        const warnings: string[] = [];
        let approved = true;
        let riskLevel: SecurityReview['riskLevel'] = 'LOW';
        const blockedPatterns: string[] = [];

        // ==================== LAYER 1: STATIC ANALYSIS ====================
        const staticResult = this.performStaticAnalysis(request.code);
        if (staticResult.blocked) {
            approved = false;
            riskLevel = 'CRITICAL';
            blockedPatterns.push(...staticResult.patterns);
            this.blockedCount++;
        }
        warnings.push(...staticResult.warnings);
        if (staticResult.riskLevel === 'HIGH' && riskLevel !== 'CRITICAL') {
            riskLevel = 'HIGH';
        }

        // ==================== LAYER 2: INTENT VERIFICATION ====================
        // Only for non-trivial code and if not already blocked
        let intentVerified = true;
        if (approved && request.code.length > 100 && request.statedPurpose) {
            intentVerified = await this.verifyIntent(request.code, request.statedPurpose, request.language);
            if (!intentVerified) {
                warnings.push('Code does not appear to match stated purpose');
                if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
            }
        }

        // ==================== LAYER 3: PERMISSION CHECK ====================
        // Currently all agents have same permissions - placeholder for RBAC
        const permissionCheck = this.checkPermissions(request.requesterId, request.language);
        if (!permissionCheck) {
            approved = false;
            warnings.push(`Agent ${request.requesterId} lacks permission for ${request.language} execution`);
        }

        // ==================== LAYER 4: PROMPT INJECTION DETECTION ====================
        const injectionCheck = this.detectPromptInjection(request.code);
        if (injectionCheck.detected) {
            warnings.push(...injectionCheck.indicators);
            if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
        }

        const review: SecurityReview = {
            approved,
            riskLevel,
            warnings,
            blockedPatterns: blockedPatterns.length > 0 ? blockedPatterns : undefined,
            analysisDetails: {
                staticAnalysis: !staticResult.blocked,
                intentVerification: intentVerified,
                permissionCheck,
                injectionCheck: !injectionCheck.detected
            },
            reviewTimeMs: Date.now() - startTime
        };

        // Emit review result
        systemBus.emit(SystemProtocol.SECURITY_REVIEW_RESULT, {
            requesterId: request.requesterId,
            approved: review.approved,
            riskLevel: review.riskLevel,
            traceId: request.traceId
        }, 'SecuritySquad');

        // Emit threat detection if blocked
        if (!approved) {
            systemBus.emit(SystemProtocol.SECURITY_THREAT_DETECTED, {
                requesterId: request.requesterId,
                patterns: blockedPatterns,
                code: request.code.substring(0, 200) + '...',
                traceId: request.traceId
            }, 'SecuritySquad');
        }

        return review;
    }

    // ==================== LAYER IMPLEMENTATIONS ====================

    private performStaticAnalysis(code: string): {
        blocked: boolean;
        patterns: string[];
        warnings: string[];
        riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    } {
        const patterns: string[] = [];
        const warnings: string[] = [];
        let blocked = false;
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

        // Check critical patterns
        for (const { pattern, description, severity } of CRITICAL_PATTERNS) {
            if (pattern.test(code)) {
                if (severity === 'CRITICAL') {
                    blocked = true;
                    patterns.push(description);
                } else {
                    warnings.push(`Potentially dangerous: ${description}`);
                    riskLevel = 'HIGH';
                }
            }
        }

        // Check suspicious patterns
        for (const { pattern, description } of SUSPICIOUS_PATTERNS) {
            if (pattern.test(code)) {
                warnings.push(`Suspicious: ${description}`);
                if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
            }
        }

        return { blocked, patterns, warnings, riskLevel };
    }

    private async verifyIntent(code: string, statedPurpose: string, language: string): Promise<boolean> {
        try {
            // Try to delegate to CYBERSEC agent via orchestrator
            try {
                const { orchestrator } = await import('../orchestrator');

                // Get active CYBERSEC agents by filtering
                const cybersecAgents = this.findSecurityAgents(orchestrator);

                if (cybersecAgents.length > 0) {
                    // Use an available CYBERSEC agent for deep analysis
                    const securityAgent = cybersecAgents[0];
                    console.log(`[SecuritySquad] 🛡️ Delegating intent verification to ${securityAgent.name}`);

                    // Request help from the security agent via SystemBus
                    const helpResponse = await systemBus.request(
                        securityAgent.id,
                        SystemProtocol.HELP_REQUEST,
                        {
                            type: 'CODE_INTENT_VERIFICATION',
                            code: code.substring(0, 1000),
                            statedPurpose,
                            language
                        },
                        `security_review_${Date.now()}`,
                        5000 // 5 second timeout
                    );

                    if (helpResponse?.payload?.verified !== undefined) {
                        return helpResponse.payload.verified;
                    }
                }
            } catch (delegationError) {
                // Orchestrator not available or no agents - fall through to direct LLM
                console.log('[SecuritySquad] Using direct LLM for intent verification (no CYBERSEC agents)');
            }

            // Fallback: Direct LLM verification
            const prompt = `
You are a security analyst. Verify if the following ${language} code matches its stated purpose.

STATED PURPOSE: ${statedPurpose}

CODE:
\`\`\`${language}
${code.substring(0, 1000)}
\`\`\`

Does this code accomplish the stated purpose WITHOUT any hidden malicious actions?
Reply with ONLY "VERIFIED" or "SUSPICIOUS" followed by a brief reason.
`;
            const response = await geminiService.generateText(prompt);
            return response.toUpperCase().includes('VERIFIED');
        } catch {
            // If we can't verify, assume it's okay but log warning
            return true;
        }
    }

    // Helper to find CYBERSEC agents from orchestrator
    private findSecurityAgents(orchestrator: any): any[] {
        try {
            // Use public getAgents() method to get all agents
            const allAgents = orchestrator.getAgents?.() || [];

            // Filter by CYBERSEC category
            return allAgents.filter((agent: any) => agent?.category === 'CYBERSEC');
        } catch {
            return [];
        }
    }

    // RBAC Permission Matrix
    private readonly PERMISSION_MATRIX: Record<string, { languages: string[], maxCodeSize: number }> = {
        'SYSTEM': { languages: ['javascript', 'typescript', 'python', 'bash'], maxCodeSize: Infinity },
        'SILHOUETTE': { languages: ['javascript', 'typescript', 'python', 'bash'], maxCodeSize: Infinity },
        'CORE': { languages: ['javascript', 'typescript', 'python'], maxCodeSize: 50000 },
        'DEV': { languages: ['javascript', 'typescript', 'python'], maxCodeSize: 50000 },
        'RESEARCH': { languages: ['javascript', 'typescript', 'python'], maxCodeSize: 10000 },
        'CYBERSEC': { languages: ['javascript', 'typescript', 'python', 'bash'], maxCodeSize: 50000 },
        'OPS': { languages: ['javascript', 'typescript', 'bash'], maxCodeSize: 20000 },
        'DEFAULT': { languages: ['javascript', 'typescript'], maxCodeSize: 5000 }
    };

    private checkPermissions(requesterId: string, language: string): boolean {
        // System agents have full permissions
        if (requesterId.startsWith('SYSTEM') || requesterId === 'SILHOUETTE') {
            return true;
        }

        // Extract agent category from ID (e.g., 'dev-01' -> 'DEV', 'research-01' -> 'RESEARCH')
        const category = this.extractAgentCategory(requesterId);
        const permissions = this.PERMISSION_MATRIX[category] || this.PERMISSION_MATRIX['DEFAULT'];

        // Check if language is permitted for this category
        if (!permissions.languages.includes(language.toLowerCase())) {
            console.warn(`[SecuritySquad] ⛔ Agent ${requesterId} (${category}) not permitted for ${language}`);
            return false;
        }

        return true;
    }

    private extractAgentCategory(agentId: string): string {
        const prefix = agentId.split('-')[0]?.toUpperCase();
        const categoryMap: Record<string, string> = {
            'DEV': 'DEV',
            'RESEARCH': 'RESEARCH',
            'QA': 'OPS',
            'CORE': 'CORE',
            'SECURITY': 'CYBERSEC',
            'OPS': 'OPS'
        };
        return categoryMap[prefix] || 'DEFAULT';
    }

    private detectPromptInjection(code: string): { detected: boolean; indicators: string[] } {
        const indicators: string[] = [];

        // Look for typical prompt injection patterns
        const injectionPatterns = [
            /ignore\s+(previous|all)\s+instructions/i,
            /you\s+are\s+now/i,
            /new\s+instructions/i,
            /forget\s+(everything|what)/i,
            /system\s*:\s*/i,
            /\]\]\s*\[\[/,  // Markdown injection
            /<\/?system>/i  // XML injection
        ];

        for (const pattern of injectionPatterns) {
            if (pattern.test(code)) {
                indicators.push(`Potential prompt injection: ${pattern.source}`);
            }
        }

        return {
            detected: indicators.length > 0,
            indicators
        };
    }

    // ==================== STATS ====================

    public getStats(): { reviewCount: number; blockedCount: number; blockRate: number } {
        return {
            reviewCount: this.reviewCount,
            blockedCount: this.blockedCount,
            blockRate: this.reviewCount > 0 ? this.blockedCount / this.reviewCount : 0
        };
    }
}

export const securitySquad = SecuritySquad.getInstance();
