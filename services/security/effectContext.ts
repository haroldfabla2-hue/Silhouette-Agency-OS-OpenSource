/**
 * Effect execution context (AsyncLocalStorage).
 *
 * Marks the current async execution as ALREADY authorized for side effects,
 * so provider-boundary guards (gmailService, imageFactory, videoFactory) do
 * not demand a second consent for a call an upstream gate already approved.
 *
 * Kinds:
 *  - 'confirmed': a consent gate approved THIS effect once
 *    (actionExecutor human confirmation via /v1/autonomy/confirmations,
 *    re-entering executeCapability).
 *  - 'user-chat': an authenticated chat session initiated this work. Chat
 *    applies its own gates (confirmationGate) where they exist; other tools
 *    run as the user's explicit request, as they did before this change.
 *  - 'user-http': an authenticated HTTP route is serving an explicit user
 *    action (the user clicked the button in the UI). Authentication alone is
 *    NOT consent for autonomous flows; this kind only marks direct,
 *    user-initiated requests handled inside the route's own async chain.
 *
 * Absence of a context means the call originates from an autonomous or
 * unauthenticated flow (daemon, scheduler, plan executor, MCP, direct
 * internal callers) and must obtain human consent before any external or
 * wallet-bearing effect runs.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface EffectContext {
    kind: 'confirmed' | 'user-chat' | 'user-http';
    /** Tool/effect the context was granted for (informational). */
    tool?: string;
    /** Which gate or route granted it (audit trail). */
    source?: string;
}

const als = new AsyncLocalStorage<EffectContext>();

export function runWithEffectContext<T>(ctx: EffectContext, fn: () => Promise<T>): Promise<T> {
    return als.run(ctx, fn);
}

export function getEffectContext(): EffectContext | undefined {
    return als.getStore();
}
