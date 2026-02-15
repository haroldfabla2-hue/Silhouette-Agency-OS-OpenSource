
import fs from 'fs/promises';
import path from 'path';
import { AgentAction, ActionType, ActionResult, SystemProtocol } from '../types';
import { gitService } from './gitService';
import { verificationService } from './verificationService';
import { systemBus } from './systemBus';

/**
 * PHASE 13/14: ACTION EXECUTOR (THE HANDS)
 * Safe abstraction layer for system side-effects.
 * Supports:
 * 1. Sandbox Mode (Safe, Isolated)
 * 2. Git Transaction Mode (Advanced, Self-Modification)
 * 3. Human-in-Loop Confirmation (Critical Actions)
 */

// === CONFIRMATION SYSTEM TYPES ===
interface PendingConfirmation {
    id: string;
    action: AgentAction;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    reason: string;
    createdAt: number;
    expiresAt: number;
    autoApprove?: boolean;
    resolve?: (approved: boolean) => void;
}

export class ActionExecutor {
    private sandboxRoot: string;
    private sandboxMode: boolean = true; // Default: Only allow sandbox
    private gitSafetyEnabled: boolean = true;

    // === HUMAN-IN-LOOP CONFIRMATION SYSTEM ===
    private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
    private confirmationTimeoutMs: number = 300000; // 5 minutes default timeout

    constructor() {
        this.sandboxRoot = path.join(process.cwd(), 'sandbox');

        // [USER REQUEST] Allow disabling sandbox for testing
        if (process.env.NO_SANDBOX === 'true') {
            console.warn("[ACTION EXECUTOR] ⚠️ SANDBOX DISABLED BY ENVIRONMENT VARIABLE");
            this.sandboxMode = false;
        }

        this.ensureSandbox();
    }

    public disableSandbox(enableGodMode: boolean = false) {
        if (enableGodMode) {
            console.warn("[ACTION EXECUTOR] ⚠️ GOD MODE ENABLED. SANDBOX DISABLED.");
            this.sandboxMode = false;
        }
    }

    private async ensureSandbox() {
        try {
            await fs.mkdir(this.sandboxRoot, { recursive: true });
        } catch (e) {
            console.error("[ACTION EXECUTOR] Failed to create sandbox:", e);
        }
    }

    /**
     * Main entry point for executing autonomous actions.
     */
    public async execute(action: AgentAction): Promise<ActionResult> {
        console.log(`[ACTION EXECUTOR] 🦾 Executing ${action.type} for ${action.agentId}`);

        try {
            switch (action.type) {
                case 'READ_FILE':
                case ActionType.READ_FILE:
                    return await this.handleReadFile(action.payload.path);

                case 'WRITE_FILE':
                case ActionType.WRITE_FILE:
                    return await this.handleWriteFile(action.payload.path, action.payload.content);

                case 'EXECUTE_COMMAND':
                case ActionType.EXECUTE_COMMAND:
                    // 1. Sandbox Check
                    if (this.sandboxMode) {
                        return { success: false, error: "System Command Execution is BLOCKED in Sandbox Mode.", timestamp: Date.now() };
                    }

                    // 2. Critical Action - Require Confirmation
                    // This is "The Hands" logic. We must ask the brain/user before typing into the shell.
                    const approved = await this.requestConfirmation(action, "Execute System Command outside sandbox");

                    if (!approved) {
                        return { success: false, error: "Command Execution Denied by User Policy.", timestamp: Date.now() };
                    }

                    // 3. Execution via SystemControl (which now deals with low-level execution)
                    try {
                        const { SystemControlService } = await import('./system/systemControlService');
                        const systemControl = SystemControlService.getInstance();
                        const cmdResult = await systemControl.executeCommand(
                            action.payload.command,
                            action.payload.cwd,
                            action.payload.background
                        );

                        return {
                            success: cmdResult.code === 0,
                            data: {
                                stdout: cmdResult.stdout,
                                stderr: cmdResult.stderr,
                                code: cmdResult.code
                            },
                            timestamp: Date.now()
                        };
                    } catch (err: any) {
                        return { success: false, error: `Command Failed: ${err.message}`, timestamp: Date.now() };
                    }

                case ActionType.SLEEP_CYCLE:
                case 'PROTOCOL_TRAINING_START' as any: // Support string mapping
                    const { trainingService } = await import('./training/trainingService');
                    if (trainingService.isBusy()) {
                        return { success: false, error: "Training already in progress.", timestamp: Date.now() };
                    }
                    trainingService.startSleepCycle();
                    // NOTE: Previous duplicate call removed - was causing parallel peer reviews
                    return { success: true, data: "Sleep Cycle Initiated", timestamp: Date.now() };

                case ActionType.GENERATE_VIDEO:
                    const { videoFactory } = await import('./media/videoFactory'); // [Phase 7] Switched to Factory

                    // Payload now supports: content (prompt), image (source path), engine (WAN/SVD)
                    const prompt = action.payload.content || "Abstract animation";
                    const sourceImage = action.payload.image || action.payload.path; // Support both for flexibility
                    const engine = action.payload.engine || 'WAN';

                    try {
                        console.log(`[ACTION EXECUTOR] 🎥 Delegating to VideoFactory: "${prompt}" (Engine: ${engine})`);

                        const job = await videoFactory.createVideo(prompt, 5, sourceImage, engine as any);

                        if (job) {
                            return {
                                success: true,
                                data: {
                                    url: job.url,
                                    provider: job.provider,
                                    status: 'QUEUED'
                                },
                                timestamp: Date.now()
                            };
                        } else {
                            return { success: false, error: "Video Factory returned null (Queue Full or Error).", timestamp: Date.now() };
                        }

                    } catch (err: any) {
                        console.error("[ACTION EXECUTOR] 🎥 Video Delegation Failed:", err);
                        return { success: false, error: `Video Delegation Failed: ${err.message}`, timestamp: Date.now() };
                    }

                // ==================== RESEARCH ACTIONS ====================
                case 'WEB_SEARCH' as any:
                case 'web_search' as any:
                    try {
                        const { webSearch } = await import('./researchTools');
                        const p = action.payload as any;
                        const searchQuery = p.query || p.content || '';
                        const maxRes = p.max_results || 5;
                        const results = await webSearch(searchQuery, maxRes);
                        return { success: true, data: results, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Web search failed: ${err.message}`, timestamp: Date.now() };
                    }

                case 'ACADEMIC_SEARCH' as any:
                case 'academic_search' as any:
                    try {
                        const { academicSearch } = await import('./researchTools');
                        const p = action.payload as any;
                        const searchQuery = p.query || p.content || '';
                        const maxRes = p.max_results || 5;
                        const papers = await academicSearch(searchQuery, maxRes);
                        return { success: true, data: papers, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Academic search failed: ${err.message}`, timestamp: Date.now() };
                    }

                case 'CONDUCT_RESEARCH' as any:
                case 'conduct_research' as any:
                    try {
                        const { conductResearch } = await import('./researchTools');
                        const p = action.payload as any;
                        const searchQuery = p.query || p.content || '';
                        const options = {
                            web: p.include_web !== false,
                            academic: p.include_academic !== false,
                            maxResults: p.max_results || 5
                        };
                        const research = await conductResearch(searchQuery, options);
                        return { success: true, data: research, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Research failed: ${err.message}`, timestamp: Date.now() };
                    }

                // ==================== SYNTHESIS ACTIONS ====================
                case 'SYNTHESIZE_DISCOVERIES' as any:
                case 'synthesize_discoveries' as any:
                    try {
                        const { synthesisService } = await import('./synthesisService');
                        const p = action.payload as any;
                        const insight = await synthesisService.synthesizeFromRecent({
                            minDiscoveries: p.minDiscoveries || 3,
                            includeResearch: p.includeResearch ?? true,
                            domain: p.domain
                        });
                        return { success: !!insight, data: insight, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Synthesis failed: ${err.message}`, timestamp: Date.now() };
                    }

                case 'GENERATE_PAPER' as any:
                case 'generate_paper' as any:
                    try {
                        const { paperGenerator } = await import('./paperGenerator');
                        const { synthesisService } = await import('./synthesisService');
                        const p = action.payload as any;

                        // Get insight
                        const insight = p.insightId
                            ? synthesisService.getInsight(p.insightId)
                            : synthesisService.getInsightsForPaper(0.7)[0];

                        if (!insight) {
                            return { success: false, error: 'No insight available', timestamp: Date.now() };
                        }

                        const paper = await paperGenerator.generateFromInsight(insight, {
                            format: p.format || 'markdown',
                            authors: p.authors || ['Silhouette AI Research']
                        });

                        // Optional peer review
                        if (p.peerReview !== false) {
                            await paperGenerator.peerReview(paper.id);
                        }

                        return { success: true, data: paper, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Paper generation failed: ${err.message}`, timestamp: Date.now() };
                    }

                // ==================== RIGOROUS PAPER PIPELINE ====================
                case 'GENERATE_RIGOROUS_PAPER' as any:
                case 'generate_rigorous_paper' as any:
                    try {
                        const { paperPipeline } = await import('./paperPipeline');
                        const p = action.payload as any;
                        const paper = await paperPipeline.generatePublicationPaper({
                            insightId: p.insightId,
                            minReferences: p.minReferences || 20,
                            generateFigures: p.generateFigures !== false,
                            format: p.format || 'markdown'
                        });
                        return { success: !!paper, data: paper, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Rigorous paper failed: ${err.message}`, timestamp: Date.now() };
                    }

                case 'COLLECT_REFERENCES' as any:
                case 'collect_references' as any:
                    try {
                        const { referenceCollector } = await import('./referenceCollector');
                        const { synthesisService } = await import('./synthesisService');
                        const p = action.payload as any;

                        const insight = p.insightId
                            ? synthesisService.getInsight(p.insightId)
                            : await synthesisService.synthesizeFromRecent({ minDiscoveries: 3 });

                        if (!insight) {
                            return { success: false, error: 'No insight available', timestamp: Date.now() };
                        }

                        const refs = await referenceCollector.buildBibliography(insight, {
                            minReferences: p.minReferences || 20,
                            minCitations: p.minCitations || 5
                        });
                        return { success: true, data: refs, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Reference collection failed: ${err.message}`, timestamp: Date.now() };
                    }

                case 'GENERATE_FIGURES' as any:
                case 'generate_figures' as any:
                    try {
                        const { figureGenerator } = await import('./figureGenerator');
                        const { synthesisService } = await import('./synthesisService');
                        const p = action.payload as any;

                        const insight = p.insightId
                            ? synthesisService.getInsight(p.insightId)
                            : await synthesisService.synthesizeFromRecent({ minDiscoveries: 3 });

                        if (!insight) {
                            return { success: false, error: 'No insight available', timestamp: Date.now() };
                        }

                        const figures = await figureGenerator.generateFiguresForPaper(insight);
                        return { success: true, data: figures, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Figure generation failed: ${err.message}`, timestamp: Date.now() };
                    }

                // ==================== DELEGATION ====================
                case 'DELEGATE_TASK' as any:
                case 'delegate_task' as any:
                    try {
                        const { capabilityRegistry } = await import('./capabilityRegistry');
                        const { agentStreamer: agentStream } = await import('./agentStream');
                        const p = action.payload as any;

                        // Find agent by capability
                        const capability = `CAP_${p.target_role?.toUpperCase()}`;
                        const agentIds = capabilityRegistry.findProviders([capability as any]);

                        if (agentIds.length === 0) {
                            return {
                                success: false,
                                error: `No agent found for capability: ${capability}`,
                                timestamp: Date.now()
                            };
                        }

                        console.log(`[DELEGATE] 🔄 Delegating to ${agentIds[0]}: "${p.task}"`);

                        // Get agent from store and execute via handleIncomingMessage
                        // Use spawnAgentStream for direct task execution
                        await agentStream.spawnAgentStream(
                            { id: agentIds[0], name: p.target_role, role: p.target_role } as any,
                            p.task,
                            p.context || {}
                        );

                        return { success: true, data: { delegatedTo: agentIds[0] }, timestamp: Date.now() };
                    } catch (err: any) {
                        return { success: false, error: `Delegation failed: ${err.message}`, timestamp: Date.now() };
                    }

                default:
                    return { success: false, error: `Unknown Action Type: ${action.type}`, timestamp: Date.now() };
            }
        } catch (error: any) {
            console.error(`[ACTION EXECUTOR] 💥 Action Failed:`, error);

            // [SELF-IMPROVEMENT] Record failure for learning
            try {
                const { experienceBuffer } = await import('./experienceBuffer');
                await experienceBuffer.recordFailure(
                    `Action ${action.type} for ${action.agentId}`,
                    JSON.stringify(action.payload).substring(0, 100),
                    error.message,
                    `Avoid similar action patterns that cause: ${error.message}`,
                    action.agentId
                );
            } catch (e) { /* non-critical */ }

            return {
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    // --- HANDLERS ---

    private async handleReadFile(filePath?: string): Promise<ActionResult> {
        if (!filePath) return { success: false, error: "No path provided", timestamp: Date.now() };

        const targetPath = this.resolvePath(filePath);
        if (!targetPath) return { success: false, error: "Access Denied", timestamp: Date.now() };

        try {
            const data = await fs.readFile(targetPath, 'utf-8');
            return { success: true, data, timestamp: Date.now() };
        } catch (e: any) {
            return { success: false, error: `File not found: ${e.message}`, timestamp: Date.now() };
        }
    }

    private async handleWriteFile(filePath?: string, content?: string): Promise<ActionResult> {
        if (!filePath) return { success: false, error: "No path provided", timestamp: Date.now() };
        if (content === undefined) return { success: false, error: "No content provided", timestamp: Date.now() };

        // RESOLUTION LOGIC UPDATE:
        // We determine targetPath first.
        let targetPath = path.resolve(filePath);

        // Check Sandboxing
        const isSandbox = targetPath.startsWith(this.sandboxRoot);

        // If OUTSIDE sandbox, we STRICTLY enforce Git Transaction for safety.
        if (!isSandbox) {
            if (this.sandboxMode) {
                // In Sandbox Mode, we ONLY allow outside writes if Git Safety is ENABLED.
                if (!this.gitSafetyEnabled) {
                    return { success: false, error: "Access Denied: Path restricted (Sandbox Active).", timestamp: Date.now() };
                }
                // If Git Safety is enabled, we PROCEED but strictly via performGitTransaction below.
            }
        }

        if (isSandbox) {
            // Simple Write for Sandbox
            try {
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.writeFile(targetPath, content, 'utf-8');
                return { success: true, data: { path: targetPath, mode: 'SANDBOX' }, timestamp: Date.now() };
            } catch (e: any) {
                return { success: false, error: `Write failed: ${e.message}`, timestamp: Date.now() };
            }
        }

        // 3. GIT TRANSACTION MODE (The "Shadow Lab") - For all non-sandbox writes
        if (this.gitSafetyEnabled) {
            return await this.performGitTransaction(targetPath, content);
        } else {
            // God Mode Raw Write (Dangerous) - Only reaches here if sandboxMode=false AND gitSafetyEnabled=false
            try {
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.writeFile(targetPath, content, 'utf-8');
                return { success: true, data: { path: targetPath, mode: 'RAW' }, timestamp: Date.now() };
            } catch (e: any) {
                return { success: false, error: `Write failed: ${e.message}`, timestamp: Date.now() };
            }
        }
    }

    /**
     * Executes the "Shadow Lab" Protocol:
     * Branch -> Write -> Verify -> Merge
     */
    private async performGitTransaction(targetPath: string, content: string): Promise<ActionResult> {
        const branchName = `autonomy/edit-${Date.now()}`;
        const originalBranch = await gitService.getCurrentBranch(); // Should be 'main'

        console.log(`[ACTION EXECUTOR] 🛡️ Starting Git Transaction on ${branchName}`);

        try {
            // 1. Branch
            await gitService.createBranch(branchName);

            // 2. Write
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, content, 'utf-8');

            // 3. Verify
            const verification = await verificationService.validate();

            if (verification.success) {
                // 4. Promote
                await gitService.commit(`AI Auto-Edit: ${path.basename(targetPath)}`);
                await gitService.checkout(originalBranch);
                await gitService.merge(branchName);
                await gitService.deleteBranch(branchName, true); // Clean up

                console.log(`[ACTION EXECUTOR] ✅ Transaction Committed.`);
                return { success: true, data: { path: targetPath, mode: 'GIT_TRANSACTION', verified: true }, timestamp: Date.now() };
            } else {
                // 5. Abort
                console.warn(`[ACTION EXECUTOR] 🛑 Verification Failed. Reverting.`);
                await gitService.checkout(originalBranch);
                await gitService.deleteBranch(branchName, true); // Force delete to discard changes

                return {
                    success: false,
                    error: `Verification Failed: ${verification.errors?.join('\n')}`,
                    timestamp: Date.now()
                };
            }

        } catch (e: any) {
            console.error(`[ACTION EXECUTOR] 💥 Transaction Crashed:`, e);
            // Emergency Cleanup
            try {
                const current = await gitService.getCurrentBranch();
                if (current === branchName) await gitService.checkout(originalBranch);
            } catch (ignore) { }

            return { success: false, error: `Transaction Error: ${e.message}`, timestamp: Date.now() };
        }
    }

    private resolvePath(targetPath: string): string | null {
        let resolvedAndNormalized = path.resolve(targetPath);

        // Allow Sandbox always
        if (resolvedAndNormalized.startsWith(this.sandboxRoot)) return resolvedAndNormalized;

        // Allow SRC only if SandboxMode is OFF
        if (!this.sandboxMode) {
            return resolvedAndNormalized;
        }

        return null; // Blocked
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HUMAN-IN-LOOP CONFIRMATION METHODS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Request user confirmation for a critical action
     * Returns true if approved, false if rejected or timed out
     */
    public async requestConfirmation(action: AgentAction, reason?: string): Promise<boolean> {
        const riskLevel = this.assessRiskLevel(action);

        // Auto-approve low risk actions
        if (riskLevel === 'LOW') {
            console.log(`[ACTION EXECUTOR] ✅ Auto-approved (low risk): ${action.type}`);
            return true;
        }

        const confirmation: PendingConfirmation = {
            id: crypto.randomUUID(),
            action,
            riskLevel,
            reason: reason || this.generateReason(action),
            createdAt: Date.now(),
            expiresAt: Date.now() + this.confirmationTimeoutMs
        };

        this.pendingConfirmations.set(confirmation.id, confirmation);

        // Emit event for UI
        systemBus.emit(SystemProtocol.CONFIRMATION_REQUIRED, {
            confirmationId: confirmation.id,
            action: {
                type: action.type,
                agentId: action.agentId,
                payload: action.payload
            },
            riskLevel,
            reason: confirmation.reason,
            expiresAt: confirmation.expiresAt
        }, 'ACTION_EXECUTOR');

        console.log(`[ACTION EXECUTOR] ⏳ Awaiting confirmation: ${confirmation.id} (Risk: ${riskLevel})`);

        // Wait for user response or timeout
        return new Promise((resolve) => {
            confirmation.resolve = resolve;

            // Set timeout
            setTimeout(() => {
                if (this.pendingConfirmations.has(confirmation.id)) {
                    console.log(`[ACTION EXECUTOR] ⏰ Confirmation timed out: ${confirmation.id}`);
                    this.pendingConfirmations.delete(confirmation.id);
                    resolve(false);
                }
            }, this.confirmationTimeoutMs);
        });
    }

    /**
     * Approve a pending action
     */
    public approveAction(confirmationId: string): boolean {
        const confirmation = this.pendingConfirmations.get(confirmationId);
        if (confirmation && confirmation.resolve) {
            console.log(`[ACTION EXECUTOR] ✅ User approved: ${confirmationId}`);
            this.pendingConfirmations.delete(confirmationId);
            confirmation.resolve(true);
            return true;
        }
        return false;
    }

    /**
     * Reject a pending action
     */
    public rejectAction(confirmationId: string): boolean {
        const confirmation = this.pendingConfirmations.get(confirmationId);
        if (confirmation && confirmation.resolve) {
            console.log(`[ACTION EXECUTOR] ❌ User rejected: ${confirmationId}`);
            this.pendingConfirmations.delete(confirmationId);
            confirmation.resolve(false);
            return true;
        }
        return false;
    }

    /**
     * Get all pending confirmations
     */
    public getPendingConfirmations(): Array<{
        id: string;
        action: AgentAction;
        riskLevel: string;
        reason: string;
        expiresAt: number;
    }> {
        return Array.from(this.pendingConfirmations.values()).map(c => ({
            id: c.id,
            action: c.action,
            riskLevel: c.riskLevel,
            reason: c.reason,
            expiresAt: c.expiresAt
        }));
    }

    /**
     * Assess risk level of an action
     */
    private assessRiskLevel(action: AgentAction): PendingConfirmation['riskLevel'] {
        const type = action.type as string;

        // CRITICAL: Could cause data loss or break things
        const criticalTypes = [
            ActionType.EXECUTE_COMMAND,
            'EXECUTE_COMMAND',
            'DELETE_FILE',
            'EXECUTE_SHELL'
        ];
        if (criticalTypes.includes(type as any)) return 'CRITICAL';

        // HIGH: Modifies system state
        const highTypes = [
            ActionType.WRITE_FILE,
            'WRITE_FILE',
            'SELF_CODE_EDIT'
        ];
        if (highTypes.includes(type as any)) return 'HIGH';

        // MEDIUM: External communication
        const mediumTypes = [
            ActionType.HTTP_REQUEST,
            'HTTP_REQUEST',
            'SEND_EMAIL',
            'API_REQUEST'
        ];
        if (mediumTypes.includes(type as any)) return 'MEDIUM';

        // LOW: Read-only or safe operations
        return 'LOW';
    }

    /**
     * Generate human-readable reason for confirmation
     */
    private generateReason(action: AgentAction): string {
        const type = action.type as string;
        switch (type) {
            case ActionType.WRITE_FILE:
            case 'WRITE_FILE':
                return `Write to file: ${action.payload?.path || 'unknown'}`;
            case ActionType.EXECUTE_COMMAND:
            case 'EXECUTE_COMMAND':
            case 'EXECUTE_SHELL':
                return `Execute command: ${action.payload?.command || 'unknown'}`;
            case ActionType.HTTP_REQUEST:
            case 'HTTP_REQUEST':
                return `HTTP request to: ${action.payload?.url || 'unknown'}`;
            default:
                return `Execute action: ${action.type}`;
        }
    }
}

export const actionExecutor = new ActionExecutor();
