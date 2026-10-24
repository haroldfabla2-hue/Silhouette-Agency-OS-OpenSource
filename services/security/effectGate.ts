/**
 * EFFECT GATE - effective permission control for external / wallet-bearing
 * effects, regardless of which code path reaches them.
 *
 * Why this exists (audit 2026-10-23): the only consent checks in the system
 * lived on the chat edge (chatToolIntegration -> confirmationGate). Every
 * other path - daemon heartbeat -> BaseAgent, scheduler -> planExecutor,
 * orchestrator.handleAutonomousAction, the MCP server, and direct provider
 * callers (imageFactory/gmailService/videoFactory) - reached the same effects
 * with at most an empty-default denylist. A gate that only watches one entry
 * point is not a permission system.
 *
 * Design:
 *  - orchestrator.executeCapability calls ensureEffectConsent() for gated
 *    tools on EVERY path (chat enters with a confirmed EffectContext and
 *    skips re-gating).
 *  - Provider-boundary guards (gmailService.sendEmail, imageFactory.createAsset,
 *    videoFactory.createVideo) call ensureEffectConsent() too, so DIRECT
 *    callers that bypass executeCapability are still stopped.
 *  - With no EffectContext, consent means a human decision through
 *    actionExecutor.requestConfirmation: the action appears at
 *    GET /v1/autonomy/confirmations and executes only after
 *    POST /v1/autonomy/confirmations/:id/approve. Rejection or timeout
 *    denies. Fail-closed: no consent, no execution.
 *
 * Deliberate exclusions (declared, not hidden):
 *  - STOCK_PHOTO style in imageFactory performs no generation; it is a stock
 *    search and is not gated as a generation effect.
 *  - generate_voice (ElevenLabs) is wallet-bearing but NOT yet gated in this
 *    change; it is recorded as a follow-up so this PR stays reviewable.
 */
import { getEffectContext } from './effectContext';

export type EffectKind = 'send_email' | 'github_create_pr' | 'generate_image' | 'generate_video';

export interface EffectPolicy {
    /** AgentAction.type used for the confirmation record (risk-classified). */
    actionType: string;
    category: 'EXTERNAL_COMMS' | 'EXTERNAL_PUBLISH' | 'COSTLY_GENERATION';
    /** True when the effect spends money or provider quota. */
    walletBearing: boolean;
}

export const EFFECT_POLICIES: Readonly<Record<EffectKind, EffectPolicy>> = Object.freeze({
    send_email: { actionType: 'SEND_EMAIL', category: 'EXTERNAL_COMMS', walletBearing: false },
    github_create_pr: { actionType: 'GITHUB_CREATE_PR', category: 'EXTERNAL_PUBLISH', walletBearing: false },
    generate_image: { actionType: 'GENERATE_IMAGE', category: 'COSTLY_GENERATION', walletBearing: true },
    generate_video: { actionType: 'GENERATE_VIDEO', category: 'COSTLY_GENERATION', walletBearing: true },
});

export function isGatedEffect(name: string): name is EffectKind {
    return Object.prototype.hasOwnProperty.call(EFFECT_POLICIES, name);
}

const clip = (v: any, n = 500): string => {
    const s = String(v ?? '');
    return s.length > n ? s.slice(0, n) + `… [${s.length} chars]` : s;
};

/** Human-readable description for the confirmation review. */
export function describeEffect(effect: EffectKind, args: Record<string, any>): string {
    switch (effect) {
        case 'send_email':
            return `Enviar email\nPara: ${args.to}${args.cc ? `\nCC: ${args.cc}` : ''}\nAsunto: ${clip(args.subject)}\nCuerpo:\n${clip(args.body, 4000)}`;
        case 'github_create_pr':
            return `Crear pull request: "${clip(args.title, 200)}" (${args.head ?? args.branch ?? '?'} -> ${args.base ?? 'main'})${args.repo ? ` en ${args.repo}` : ''}`;
        case 'generate_image':
            return `Generar imagen (coste de proveedor)\nEstilo: ${args.style ?? 'PHOTOREALISTIC'} ${args.aspectRatio ?? ''}\nPrompt: ${clip(args.prompt, 1000)}`;
        case 'generate_video':
            return `Generar vídeo (coste de proveedor)\nPrompt: ${clip(args.prompt, 1000)}`;
    }
}

export type ConsentDecision =
    | { allowed: true; via: 'context' | 'human-approval' }
    | { allowed: false; reason: string };

/**
 * Consent for one effect execution. With an upstream EffectContext the call
 * is already authorized (single pass-through). Without one, a human must
 * approve through actionExecutor (visible and decided at
 * /v1/autonomy/confirmations). Rejection or timeout denies.
 */
export async function ensureEffectConsent(
    effect: EffectKind,
    args: Record<string, any>,
    origin: string
): Promise<ConsentDecision> {
    const ctx = getEffectContext();
    if (ctx?.kind === 'confirmed' || ctx?.kind === 'user-chat' || ctx?.kind === 'user-http') {
        return { allowed: true, via: 'context' };
    }

    const policy = EFFECT_POLICIES[effect];
    const { actionExecutor } = await import('../actionExecutor');
    const action = {
        id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        agentId: origin,
        type: policy.actionType as any,
        payload: { effect, args },
        status: 'PENDING' as any,
        timestamp: Date.now(),
        requiresApproval: true
    };

    console.warn(`[EFFECT_GATE] ⏸️ ${effect} from ${origin} requires human confirmation (/${policy.category}${policy.walletBearing ? ', wallet-bearing' : ''}). Pending at /v1/autonomy/confirmations`);
    const approved = await actionExecutor.requestConfirmation(
        action,
        `${describeEffect(effect, args)}\nOrigen: ${origin}`
    );

    if (approved) {
        console.log(`[EFFECT_GATE] ✅ ${effect} approved by human confirmation (origin: ${origin})`);
        return { allowed: true, via: 'human-approval' };
    }
    console.warn(`[EFFECT_GATE] ⛔ ${effect} denied or confirmation expired (origin: ${origin})`);
    return {
        allowed: false,
        reason: `Efecto "${effect}" sin consentimiento: fue rechazado o expiró la confirmación humana (${origin}).`
    };
}
