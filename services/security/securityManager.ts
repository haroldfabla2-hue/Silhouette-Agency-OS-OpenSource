// =============================================================================
// SECURITY MANAGER
// Centralized tool security: allowlists, denylists, exec approvals.
// Comprehensive security model for autonomous agents.
// =============================================================================

import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SecurityPolicy {
    /** Tools that are always allowed without approval */
    allowlist: Set<string>;
    /** Tools that are always blocked */
    denylist: Set<string>;
    /** Whether side-effecting tools require human approval */
    requireApproval: boolean;
    /** Maximum execution timeout for tools in ms */
    maxExecTimeoutMs: number;
    /** Whether code execution sandbox is enabled */
    sandboxEnabled: boolean;
}

export interface ApprovalRequest {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    requestedBy: string;   // Agent or session ID
    requestedAt: number;
    status: 'pending' | 'approved' | 'denied';
    decidedBy?: string;
    decidedAt?: number;
    expiresAt: number;
}

export type SecurityVerdict =
    | { allowed: true }
    | { allowed: false; reason: string; requiresApproval?: boolean; approvalId?: string };

// ─── Dangerous Tools ─────────────────────────────────────────────────────────

/**
 * Tools that can have side effects and require extra caution.
 */
const DANGEROUS_TOOLS = new Set([
    'execute_code',
    'write_file',
    'shell_exec',
    'github_create_pr',
    'send_email',
    'workspace_create',
    'workspace_update',
    'start_video_production',
    'create_tool',
]);

/**
 * Tools that are always safe (read-only, no side effects).
 */
const SAFE_TOOLS = new Set([
    'web_search',
    'read_file',
    'list_files',
    'list_my_tools',
    'workspace_read',
    'workspace_list',
    'workspace_search',
    'get_production_status',
    'list_productions',
    'list_visual_assets',
    'search_assets',
    'preview_asset',
    'read_inbox',
]);

// ─── Security Manager ────────────────────────────────────────────────────────

class SecurityManager {
    private policy: SecurityPolicy;
    private pendingApprovals: Map<string, ApprovalRequest> = new Map();
    private auditLog: { action: string; tool: string; verdict: string; timestamp: number }[] = [];
    private readonly MAX_AUDIT_LOG = 500;
    private readonly APPROVAL_TIMEOUT_MS = 5 * 60_000; // 5 minutes
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.policy = {
            allowlist: new Set(SAFE_TOOLS),
            denylist: new Set(),
            requireApproval: true,
            maxExecTimeoutMs: 30_000,
            sandboxEnabled: false,
        };
    }

    // ── Init ──────────────────────────────────────────────────────────────

    initialize(config?: Partial<SecurityPolicy>): void {
        if (config?.allowlist) {
            for (const tool of config.allowlist) this.policy.allowlist.add(tool);
        }
        if (config?.denylist) {
            for (const tool of config.denylist) this.policy.denylist.add(tool);
        }
        if (config?.requireApproval !== undefined) {
            this.policy.requireApproval = config.requireApproval;
        }
        if (config?.sandboxEnabled !== undefined) {
            this.policy.sandboxEnabled = config.sandboxEnabled;
        }

        // Cleanup expired approvals periodically
        this.cleanupInterval = setInterval(() => this.cleanupExpiredApprovals(), 60_000);

        console.log(`[Security] 🛡️ Initialized (approval: ${this.policy.requireApproval}, sandbox: ${this.policy.sandboxEnabled})`);
    }

    // ── Verdict ───────────────────────────────────────────────────────────

    /**
     * Check if a tool execution is allowed.
     * Returns a verdict with reason if denied.
     */
    checkTool(toolName: string, args: Record<string, unknown>, requestedBy: string): SecurityVerdict {
        // 1. Check denylist first (highest priority)
        if (this.policy.denylist.has(toolName)) {
            this.log('DENIED', toolName, 'Tool is in denylist');
            return { allowed: false, reason: `Tool "${toolName}" is blocked by security policy` };
        }

        // 2. Check allowlist (always allowed)
        if (this.policy.allowlist.has(toolName)) {
            this.log('ALLOWED', toolName, 'In allowlist');
            return { allowed: true };
        }

        // 3. Check if it's a dangerous tool and approval is required
        if (this.policy.requireApproval && DANGEROUS_TOOLS.has(toolName)) {
            const approvalId = this.createApprovalRequest(toolName, args, requestedBy);
            this.log('PENDING_APPROVAL', toolName, 'Requires human approval');

            // Emit event for UI to show approval dialog
            systemBus.emit(SystemProtocol.CONFIRMATION_REQUIRED, {
                approvalId,
                toolName,
                args,
                requestedBy,
                message: `Tool "${toolName}" requires approval before execution`,
            }, 'SecurityManager');

            return {
                allowed: false,
                reason: `Tool "${toolName}" requires human approval`,
                requiresApproval: true,
                approvalId,
            };
        }

        // 4. Default: allow unknown tools
        this.log('ALLOWED', toolName, 'Default allow');
        return { allowed: true };
    }

    // ── Approvals ─────────────────────────────────────────────────────────

    private createApprovalRequest(toolName: string, args: Record<string, unknown>, requestedBy: string): string {
        const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const request: ApprovalRequest = {
            id,
            toolName,
            args,
            requestedBy,
            requestedAt: Date.now(),
            status: 'pending',
            expiresAt: Date.now() + this.APPROVAL_TIMEOUT_MS,
        };
        this.pendingApprovals.set(id, request);
        return id;
    }

    /**
     * Approve a pending tool execution.
     */
    approve(approvalId: string, decidedBy: string = 'user'): ApprovalRequest | null {
        const request = this.pendingApprovals.get(approvalId);
        if (!request || request.status !== 'pending') return null;

        request.status = 'approved';
        request.decidedBy = decidedBy;
        request.decidedAt = Date.now();

        this.log('APPROVED', request.toolName, `Approved by ${decidedBy}`);
        return request;
    }

    /**
     * Deny a pending tool execution.
     */
    deny(approvalId: string, decidedBy: string = 'user'): ApprovalRequest | null {
        const request = this.pendingApprovals.get(approvalId);
        if (!request || request.status !== 'pending') return null;

        request.status = 'denied';
        request.decidedBy = decidedBy;
        request.decidedAt = Date.now();

        this.log('DENIED', request.toolName, `Denied by ${decidedBy}`);
        return request;
    }

    /**
     * Check if an approval has been granted.
     */
    isApproved(approvalId: string): boolean {
        const request = this.pendingApprovals.get(approvalId);
        return request?.status === 'approved';
    }

    /**
     * Get pending approval requests.
     */
    getPendingApprovals(): ApprovalRequest[] {
        return Array.from(this.pendingApprovals.values())
            .filter(r => r.status === 'pending' && r.expiresAt > Date.now());
    }

    private cleanupExpiredApprovals(): void {
        const now = Date.now();
        for (const [id, request] of this.pendingApprovals.entries()) {
            if (request.expiresAt < now && request.status === 'pending') {
                request.status = 'denied';
                this.pendingApprovals.delete(id);
            }
        }
    }

    // ── Policy Management ─────────────────────────────────────────────────

    addToAllowlist(toolName: string): void {
        this.policy.allowlist.add(toolName);
        this.policy.denylist.delete(toolName); // Remove from denylist if present
    }

    addToDenylist(toolName: string): void {
        this.policy.denylist.add(toolName);
        this.policy.allowlist.delete(toolName); // Remove from allowlist if present
    }

    removeFromAllowlist(toolName: string): void {
        this.policy.allowlist.delete(toolName);
    }

    removeFromDenylist(toolName: string): void {
        this.policy.denylist.delete(toolName);
    }

    setApprovalRequired(required: boolean): void {
        this.policy.requireApproval = required;
    }

    getPolicy(): SecurityPolicy {
        return {
            ...this.policy,
            allowlist: new Set(this.policy.allowlist),
            denylist: new Set(this.policy.denylist),
        };
    }

    // ── Audit Log ─────────────────────────────────────────────────────────

    private log(action: string, tool: string, verdict: string): void {
        this.auditLog.push({ action, tool, verdict, timestamp: Date.now() });
        if (this.auditLog.length > this.MAX_AUDIT_LOG) {
            this.auditLog = this.auditLog.slice(-this.MAX_AUDIT_LOG);
        }
    }

    getAuditLog(limit: number = 50): typeof this.auditLog {
        return this.auditLog.slice(-limit);
    }

    // ── Stats ─────────────────────────────────────────────────────────────

    getStats() {
        return {
            allowlistSize: this.policy.allowlist.size,
            denylistSize: this.policy.denylist.size,
            requireApproval: this.policy.requireApproval,
            sandboxEnabled: this.policy.sandboxEnabled,
            pendingApprovals: this.getPendingApprovals().length,
            auditLogSize: this.auditLog.length,
        };
    }

    // ── Shutdown ───────────────────────────────────────────────────────────

    shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const securityManager = new SecurityManager();
