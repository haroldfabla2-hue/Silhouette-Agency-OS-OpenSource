import { SystemProtocol } from '../../types';
import { systemBus, MessagePriority, MessageTag } from '../systemBus';

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

// Identity comes from the executing agent, never from model-supplied tool args.
export function requestCollaboration(args: { target_role: string; message: string; context?: unknown; priority?: string }, caller?: ToolCaller) {
    if (!caller?.requesterId || caller.requesterId === 'unknown') return { error: 'Collaboration requires an identified requesting agent' };
    if (!args.target_role?.trim() || !args.message?.trim()) return { error: 'Missing role or message' };
    const requestId = crypto.randomUUID();
    const priority = Object.values(MessagePriority).includes(args.priority as MessagePriority)
        ? args.priority as MessagePriority : MessagePriority.NORMAL;
    systemBus.emit(SystemProtocol.HELP_REQUEST, {
        requestId, requesterId: caller.requesterId, requesterRole: caller.requesterRole || caller.requesterId,
        targetRole: args.target_role, problem: args.message, context: args.context, priority
    } satisfies HelpRequest, caller.requesterId);
    return { status: 'queued', id: requestId, message: `Collaboration request queued for ${args.target_role}.` };
}

export function emitHelpResponse(request: Pick<HelpRequest, 'requestId' | 'requesterId'>, helperId: string, solution: string, success: boolean) {
    systemBus.emit(SystemProtocol.HELP_RESPONSE, {
        requestId: request.requestId, requesterId: request.requesterId, helperId, solution, success
    } satisfies HelpResponse, helperId);
}

/** Shared by the live orchestrator and transport integration tests. */
export function subscribeHelpProtocol(deps: {
    findHelper: (role: string) => string | null;
    prepare: (request: HelpRequest, helperId: string) => Promise<unknown>;
}) {
    const offRequest = systemBus.subscribe(SystemProtocol.HELP_REQUEST, event => {
        const request = event.payload as HelpRequest;
        if (!request?.requesterId || !request.targetRole || !request.problem) return;
        // Keep async failures inside the subscription: the bus does not await handlers.
        void (async () => {
            let helperId = 'system';
            try {
                const found = deps.findHelper(request.targetRole);
                if (!found) {
                    emitHelpResponse(request, helperId, `No specialist found for role: ${request.targetRole}`, false);
                    return;
                }
                helperId = found;
                const context = await deps.prepare(request, helperId);
                systemBus.send(systemBus.createMessage(request.requesterId, helperId, SystemProtocol.HELP_REQUEST,
                    { ...request, context }, { tag: MessageTag.HELP_REQUEST, priority: request.priority || MessagePriority.HIGH, traceId: request.requestId }));
            } catch (error) {
                emitHelpResponse(request, helperId, `Unable to route help: ${error instanceof Error ? error.message : String(error)}`, false);
            }
        })();
    });
    const offResponse = systemBus.subscribe(SystemProtocol.HELP_RESPONSE, event => {
        const response = event.payload as HelpResponse;
        if (!response?.requesterId || !response.helperId || typeof response.solution !== 'string') return;
        systemBus.send(systemBus.createMessage(response.helperId, response.requesterId, SystemProtocol.HELP_RESPONSE,
            response, { tag: MessageTag.HELP_REQUEST, priority: MessagePriority.HIGH, traceId: response.requestId }));
    });
    return () => { offRequest(); offResponse(); };
}
