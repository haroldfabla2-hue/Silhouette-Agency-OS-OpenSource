import { SystemProtocol } from '../../types';
import { systemBus, MessagePriority, MessageTag } from '../systemBus';
import type { ReputationFact } from '../org/reputationLedger';

export interface ToolCaller { requesterId: string; requesterRole?: string }
export interface HelpRequest {
    requestId: string;
    requesterId: string;
    requesterRole: string;
    targetRole: string;
    problem: string;
    context?: unknown;
    priority?: MessagePriority;
}
export interface HelpResponse {
    requestId?: string;
    requesterId: string;
    helperId: string;
    solution: string;
    success: boolean;
}

export interface CollaborationArgs { target_role: string; message: string; context?: unknown; priority?: string }

// Identity comes from the executing agent, never from model-supplied tool args.
function buildHelpRequest(args: CollaborationArgs, caller?: ToolCaller): { error: string } | { request: HelpRequest } {
    if (!caller?.requesterId || caller.requesterId === 'unknown') return { error: 'Collaboration requires an identified requesting agent' };
    if (!args.target_role?.trim() || !args.message?.trim()) return { error: 'Missing role or message' };
    const requestId = crypto.randomUUID();
    const priority = Object.values(MessagePriority).includes(args.priority as MessagePriority)
        ? args.priority as MessagePriority : MessagePriority.NORMAL;
    return {
        request: {
            requestId, requesterId: caller.requesterId, requesterRole: caller.requesterRole || caller.requesterId,
            targetRole: args.target_role, problem: args.message, context: args.context, priority
        }
    };
}

function emitHelpRequest(request: HelpRequest): void {
    systemBus.emit(SystemProtocol.HELP_REQUEST, request, request.requesterId);
}

export function requestCollaboration(args: CollaborationArgs, caller?: ToolCaller) {
    const built = buildHelpRequest(args, caller);
    if ('error' in built) return built;
    emitHelpRequest(built.request);
    return { status: 'queued', id: built.request.requestId, message: `Collaboration request queued for ${args.target_role}.` };
}

export type CollaborationResult =
    | { status: 'answered'; id: string; helperId: string; solution: string; success: boolean }
    | { status: 'timeout'; id: string; message: string }
    | { error: string };

/**
 * Root fix for "help responses nobody hears": the caller subscribes for the
 * correlated HELP_RESPONSE BEFORE emitting, and awaits the real answer (or an
 * explicit unroutable failure, which also arrives as a HELP_RESPONSE). On
 * timeout the model gets an explicit status instead of silence. The tool loop
 * already awaits tool results, so the answer lands inside the calling agent's
 * own turn — help is real, not queued into the void.
 */
export function requestCollaborationAndWait(
    args: CollaborationArgs,
    caller?: ToolCaller,
    opts: { timeoutMs?: number } = {}
): Promise<CollaborationResult> {
    const timeoutMs = opts.timeoutMs ?? 45_000;
    const built = buildHelpRequest(args, caller);
    if ('error' in built) return Promise.resolve(built);
    const request = built.request;
    return new Promise(resolve => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = systemBus.subscribe(SystemProtocol.HELP_RESPONSE, event => {
            const response = event.payload as HelpResponse;
            if (!response?.requestId || response.requestId !== request.requestId) return;
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            off();
            resolve({ status: 'answered', id: response.requestId, helperId: response.helperId, solution: response.solution, success: response.success });
        });
        // Subscribe BEFORE emitting: even a fully synchronous failure path
        // (e.g. unroutable role answered in the same tick) is heard.
        emitHelpRequest(request);
        timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            off();
            resolve({ status: 'timeout', id: request.requestId, message: `No answer from ${args.target_role} within ${timeoutMs}ms.` });
        }, timeoutMs);
    });
}

export function emitHelpResponse(request: Pick<HelpRequest, 'requestId' | 'requesterId'>, helperId: string, solution: string, success: boolean) {
    systemBus.emit(SystemProtocol.HELP_RESPONSE, {
        requestId: request.requestId, requesterId: request.requesterId, helperId, solution, success
    } satisfies HelpResponse, helperId);
}

/** Shared by the live orchestrator and transport integration tests. */
export function subscribeHelpProtocol(deps: {
    // `request` lets resolvers use the requester's identity (e.g. '@team-head'
    // resolves against the requester's own team). Optional for back-compat.
    findHelper: (role: string, request?: HelpRequest) => string | null;
    prepare: (request: HelpRequest, helperId: string) => Promise<unknown>;
    // Optional evidence sink: collaboration facts for the reputation ledger.
    // Recording must never break the bus — failures are logged, not thrown.
    recordFact?: (fact: Omit<ReputationFact, 'seq'>) => void;
}) {
    // In-flight requests so responses can be matched with latency + context.
    const inflight = new Map<string, { ts: number; helperId: string; requesterId: string; targetRole: string }>();
    const record = (fact: Omit<ReputationFact, 'seq'>): void => {
        try { deps.recordFact?.(fact); } catch (error) {
            console.warn(`[HELP] reputation fact not recorded: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const offRequest = systemBus.subscribe(SystemProtocol.HELP_REQUEST, event => {
        const request = event.payload as HelpRequest;
        if (!request?.requesterId || !request.targetRole || !request.problem) return;
        // Keep async failures inside the subscription: the bus does not await handlers.
        void (async () => {
            let helperId = 'system';
            try {
                const found = deps.findHelper(request.targetRole, request);
                if (!found) {
                    record({ ts: Date.now(), type: 'COLLAB_UNROUTABLE', agentId: request.requesterId,
                        context: request.targetRole, success: false, requestId: request.requestId,
                        reason: `no specialist found for role '${request.targetRole}'` });
                    emitHelpResponse(request, helperId, `No specialist found for role: ${request.targetRole}`, false);
                    return;
                }
                helperId = found;
                const context = await deps.prepare(request, helperId);
                inflight.set(request.requestId, { ts: Date.now(), helperId, requesterId: request.requesterId, targetRole: request.targetRole });
                record({ ts: Date.now(), type: 'COLLAB_REQUESTED', agentId: helperId, counterpartId: request.requesterId,
                    context: request.targetRole, requestId: request.requestId,
                    reason: `help request routed to ${helperId}` });
                systemBus.send(systemBus.createMessage(request.requesterId, helperId, SystemProtocol.HELP_REQUEST,
                    { ...request, context }, { tag: MessageTag.HELP_REQUEST, priority: request.priority || MessagePriority.HIGH, traceId: request.requestId }));
            } catch (error) {
                record({ ts: Date.now(), type: 'COLLAB_UNROUTABLE', agentId: request.requesterId,
                    context: request.targetRole, success: false, requestId: request.requestId,
                    reason: `routing failed: ${error instanceof Error ? error.message : String(error)}` });
                emitHelpResponse(request, helperId, `Unable to route help: ${error instanceof Error ? error.message : String(error)}`, false);
            }
        })();
    });
    const offResponse = systemBus.subscribe(SystemProtocol.HELP_RESPONSE, event => {
        const response = event.payload as HelpResponse;
        if (!response?.requesterId || !response.helperId || typeof response.solution !== 'string') return;
        const tracked = response.requestId ? inflight.get(response.requestId) : undefined;
        if (response.requestId) inflight.delete(response.requestId);
        const context = tracked?.targetRole;
        const latencyMs = tracked ? Date.now() - tracked.ts : undefined;
        record({ ts: Date.now(), type: 'COLLAB_HELPED', agentId: response.helperId, counterpartId: response.requesterId,
            context, success: response.success, latencyMs, requestId: response.requestId,
            reason: `help ${response.success ? 'succeeded' : 'failed'}` });
        record({ ts: Date.now(), type: 'COLLAB_SERVED', agentId: response.requesterId, counterpartId: response.helperId,
            context, success: response.success, requestId: response.requestId,
            reason: `received help from ${response.helperId}` });
        systemBus.send(systemBus.createMessage(response.helperId, response.requesterId, SystemProtocol.HELP_RESPONSE,
            response, { tag: MessageTag.HELP_REQUEST, priority: MessagePriority.HIGH, traceId: response.requestId }));
    });
    return () => { offRequest(); offResponse(); };
}
