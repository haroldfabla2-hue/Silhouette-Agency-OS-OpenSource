/**
 * EFFECT GATE v4 - specific, single-use authority for external effects, on
 * every code path. Wallet-bearing provider effects are HARD-BLOCKED here.
 *
 * History 2026-10-23: v1 rejected (provenance contexts "user-chat"/"user-http"
 * are NOT consent). v2/v3 rejected (config flag allowPaidEffects was a
 * permission slip, not budget authority; any shared-token holder could approve
 * confirmations; parallel consumers with identical args both passed).
 *
 * v4 rules:
 *  1. WALLET-BEARING effects (cloud image/video/voice): HARD-DENIED in this
 *     delivery. The system cannot verify per-piece cost and no budget/total/
 *     cap mechanism exists, so NO flag, grant or human click authorizes spend.
 *     Pending a real budget/cap design. CERO COBROS.
 *  2. NON-WALLET gated effects (send_email, github_create_pr) run ONLY with:
 *     a. a SINGLE-USE grant bound to effect + EXACT canonical args
 *        (ApprovalGrantStore: consume-once, timing-safe, expiring), issued
 *        ONLY by chatToolIntegration AFTER confirmationGate's EXECUTE
 *        decision (explicit "CONFIRMAR <token>" from the authenticated
 *        principal in the same conversation, exact args); or
 *     b. a human approval at /v1/autonomy/confirmations (actionExecutor),
 *        whose endpoints now require an ATTRIBUTED HUMAN SESSION - the shared
 *        system API token cannot approve or read confirmations.
 *  3. Consume-once is tied to the PROVIDER INVOCATION: wrapper layers
 *     validate the grant WITHOUT consuming; the provider-invoking boundary
 *     consumes atomically. Parallel consumers with identical args: exactly
 *     one invocation passes. A second invocation at the boundary denies as a
 *     typed retry.
 *
 * Denial is TYPED: EffectDeniedError (code EFFECT_DENIED). Callers must not
 * retry, fall back to another provider, or retry under another identity on
 * denial; the error propagates visibly.
 *
 * Declared limits:
 *  - Campaign/multi-piece flows have NO scope approval here: each piece
 *    requires its own grant or its own human approval. A scoped campaign
 *    grant (explicit piece counts + cost cap) is future work, not guessed.
 *  - amountCents/currency in the binding stay null: per-piece provider cost
 *    is not knowable upfront; the enforceable binding is exact args.
 */
import crypto from 'node:crypto';
import { approvalGrants, bindingDigest, type ApprovalBinding } from './approvalGrants';
import { getEffectContext, type EffectContext } from './effectContext';

export class EffectDeniedError extends Error {
    public readonly code = 'EFFECT_DENIED' as const;
    constructor(reason: string) {
        super(`EFFECT_DENIED: ${reason}`);
        this.name = 'EffectDeniedError';
    }
}

export type EffectKind = 'send_email' | 'github_create_pr' | 'generate_image' | 'generate_video' | 'generate_voice';

export interface EffectPolicy {
    actionType: string;
    category: 'EXTERNAL_COMMS' | 'EXTERNAL_PUBLISH' | 'COSTLY_GENERATION';
    walletBearing: boolean;
    /** Args participating in the binding digest. Only these are canonicalized. */
    bindingArgs: string[];
}

export const EFFECT_POLICIES: Readonly<Record<EffectKind, EffectPolicy>> = Object.freeze({
    send_email: {
        actionType: 'SEND_EMAIL', category: 'EXTERNAL_COMMS', walletBearing: false,
        bindingArgs: ['to', 'cc', 'subject', 'body']
    },
    github_create_pr: {
        actionType: 'GITHUB_CREATE_PR', category: 'EXTERNAL_PUBLISH', walletBearing: false,
        bindingArgs: ['title', 'body', 'head', 'branch', 'base', 'repo']
    },
    generate_image: {
        actionType: 'GENERATE_IMAGE', category: 'COSTLY_GENERATION', walletBearing: true,
        bindingArgs: ['prompt', 'style', 'aspectRatio', 'negativePrompt', 'count']
    },
    generate_video: {
        actionType: 'GENERATE_VIDEO', category: 'COSTLY_GENERATION', walletBearing: true,
        bindingArgs: ['prompt', 'duration', 'engine']
    },
    generate_voice: {
        actionType: 'GENERATE_VOICE', category: 'COSTLY_GENERATION', walletBearing: true,
        bindingArgs: ['text', 'voiceId']
    },
});

export function isGatedEffect(name: string): name is EffectKind {
    return Object.prototype.hasOwnProperty.call(EFFECT_POLICIES, name);
}

/**
 * Handler defaults, applied BEFORE binding so every layer of one logical
 * invocation canonicalizes identically (chat grant on raw args, toolHandler
 * defaults, provider boundary). MUST match the handlers:
 * toolHandler.handleGenerateImage (style 'PHOTOREALISTIC', aspectRatio
 * '16:9') and handleGenerateVideo (engine 'WAN', duration 5).
 */
const NORMALIZED_DEFAULTS: Partial<Record<EffectKind, Record<string, any>>> = {
    generate_image: { style: 'PHOTOREALISTIC', aspectRatio: '16:9' },
    generate_video: { engine: 'WAN', duration: 5 },
};

const canonical = (args: Record<string, any>): string => {
    const sorted: Record<string, any> = {};
    for (const k of Object.keys(args).sort()) {
        if (args[k] !== undefined) sorted[k] = args[k];
    }
    return JSON.stringify(sorted);
};

/** Canonical arg subset for an effect's binding (both issuer and boundary use
 *  this). Handler defaults are normalized in so a grant issued on raw args
 *  matches the boundary's defaulted args for the SAME logical invocation. */
export function bindingArgsFor(effect: EffectKind, rawArgs: Record<string, any>): Record<string, any> {
    const defaults = NORMALIZED_DEFAULTS[effect] ?? {};
    const out: Record<string, any> = {};
    for (const k of EFFECT_POLICIES[effect].bindingArgs) {
        const v = rawArgs[k] !== undefined ? rawArgs[k] : defaults[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

/** Binding for one exact invocation: type = effect, destination = digest of effect+canonical args. */
export function effectBinding(effect: EffectKind, args: Record<string, any>): ApprovalBinding {
    const subset = bindingArgsFor(effect, args);
    return {
        type: effect,
        destination: crypto.createHash('sha256').update(`${effect}:${canonical(subset)}`).digest('hex'),
    };
}

/**
 * Issue a single-use grant for one exact effect invocation. Call ONLY where
 * authority exists: after confirmationGate EXECUTE (chat), or in an
 * authenticated route whose body is the principal's exact specification.
 */
export function issueEffectGrant(effect: EffectKind, args: Record<string, any>, issuedBy: string): EffectContext {
    const binding = effectBinding(effect, args);
    const grant = approvalGrants.issue(binding);
    console.log(`[EFFECT_GATE] 🎟️ grant issued for ${effect} by ${issuedBy} (single-use, args-bound, one provider invocation)`);
    return { grant: { token: grant.token, binding }, validated: new Set(), issuedBy };
}

/** Effects whose ONLY gate is the executeCapability chokepoint (no deeper
 *  provider-boundary call site). For these, the capability-level call IS the
 *  invocation boundary and must consume the grant. */
export const CAPABILITY_LEVEL_BOUNDARY_EFFECTS: ReadonlySet<EffectKind> = new Set(['github_create_pr']);

/** Token marking a pseudo-grant minted by the confirmations flow after a
 *  human approval (no store token; consume-once comes from the single
 *  resolution of the pending confirmation plus the per-chain validated set). */
export const HUMAN_APPROVED_TOKEN = 'human-approved';

const clip = (v: any, n = 500): string => {
    const s = String(v ?? '');
    return s.length > n ? s.slice(0, n) + `… [${s.length} chars]` : s;
};

export function describeEffect(effect: EffectKind, args: Record<string, any>): string {
    switch (effect) {
        case 'send_email':
            return `Enviar email\nPara: ${args.to}${args.cc ? `\nCC: ${args.cc}` : ''}\nAsunto: ${clip(args.subject)}\nCuerpo:\n${clip(args.body, 4000)}`;
        case 'github_create_pr':
            return `Crear pull request: "${clip(args.title, 200)}" (${args.head ?? args.branch ?? '?'} -> ${args.base ?? 'main'})${args.repo ? ` en ${args.repo}` : ''}`;
        case 'generate_image':
            return `Generar imagen (coste de proveedor; coste por pieza NO verificable por el sistema, sin límite de gasto configurado)\nEstilo: ${args.style ?? 'PHOTOREALISTIC'} ${args.aspectRatio ?? ''}\nPrompt: ${clip(args.prompt, 1000)}`;
        case 'generate_video':
            return `Generar vídeo (coste de proveedor; coste por pieza NO verificable por el sistema, sin límite de gasto configurado)\nMotor: ${args.engine ?? '?'}\nPrompt: ${clip(args.prompt, 1000)}`;
        case 'generate_voice':
            return `Generar voz (coste de proveedor; coste por pieza NO verificable por el sistema, sin límite de gasto configurado)\nVoz: ${args.voiceId ?? 'default'}\nTexto: ${clip(args.text, 1000)}`;
    }
}

export interface ConsentGranted { via: 'grant' | 'human-approval'; digest: string }

/**
 * The single enforcement function every gated path must call. Returns on
 * approval; THROWS EffectDeniedError on any denial (typed, visible; callers
 * must not retry or fall back).
 *
 * With a context: WRAPPER layers (opts.providerBoundary falsy) validate the
 * grant binding and state WITHOUT consuming - they never invoke the provider.
 * The PROVIDER-INVOKING BOUNDARY (opts.providerBoundary true) consumes the
 * grant atomically: exactly ONE provider invocation per grant, even under
 * parallel consumers with identical args. A digest already consumed in this
 * same chain denies at the boundary (retry) and passes at wrappers (same
 * logical invocation travelling outward-in happened before it).
 *
 * Without a context: human approval via actionExecutor (pending at
 * /v1/autonomy/confirmations). Approval executes this piece once; rejection
 * or timeout denies.
 */
export async function ensureEffectConsent(
    effect: EffectKind,
    args: Record<string, any>,
    origin: string,
    opts: { providerBoundary?: boolean } = {}
): Promise<ConsentGranted> {
    const policy = EFFECT_POLICIES[effect];

    // CERO COBROS: wallet-bearing provider effects (cloud image/video/voice)
    // are HARD-BLOCKED in this delivery. The system cannot verify per-piece
    // cost upfront and no budget/total/cap mechanism exists yet, so NO flag,
    // grant or human click can authorize spend here - a boolean would be a
    // permission slip, not budget authority. The feature stays pending a
    // real budget/cap design; nothing is spent.
    if (policy.walletBearing) {
        throw new EffectDeniedError(
            `efecto "${effect}" bloqueado: es de coste y el sistema no puede verificar coste/límite por pieza. ` +
            `Pendiente de un mecanismo de presupuesto/cap autorizado (no habilitable en esta entrega). No se gastó nada.`
        );
    }

    const binding = effectBinding(effect, args);
    const digest = bindingDigest(binding);
    const ctx = getEffectContext();

    if (ctx) {
        const pseudo = ctx.grant.token === HUMAN_APPROVED_TOKEN;
        const bindingMatches = () => bindingDigest(ctx.grant.binding) === digest;

        if (opts.providerBoundary) {
            // ── Provider-invoking boundary: consume-once lives HERE. ──
            // Exactly one provider invocation per grant/approval, even with
            // parallel consumers carrying identical args.
            if (ctx.validated.has(digest)) {
                throw new EffectDeniedError(
                    `reintento denegado: este grant ya ejecutó ${effect} en esta cadena. ` +
                    `Un grant autoriza exactamente una invocación de proveedor.`
                );
            }
            if (pseudo) {
                if (!bindingMatches()) {
                    throw new EffectDeniedError(`aprobación humana no ligada a estos argumentos para ${effect} (MISMATCH).`);
                }
            } else {
                const check = approvalGrants.consume(ctx.grant.token, binding);
                if (check.ok !== true) {
                    const reason = (check as { ok: false; reason: string }).reason;
                    throw new EffectDeniedError(
                        `grant inválido para ${effect} (${reason}; emitido por ${ctx.issuedBy}). ` +
                        `Sin reintento: cada efecto requiere su propia aprobación ligada a sus argumentos exactos.`
                    );
                }
            }
            ctx.validated.add(digest);
            console.log(`[EFFECT_GATE] ✅ ${effect} provider invocation authorized (issued by ${ctx.issuedBy}, boundary: ${origin})`);
            return { via: 'grant', digest };
        }

        // ── Wrapper layer: validate authority WITHOUT consuming. Wrappers
        // never invoke the provider; the boundary serializes invocations. ──
        if (ctx.validated.has(digest)) return { via: 'grant', digest };
        if (pseudo) {
            if (!bindingMatches()) {
                throw new EffectDeniedError(`aprobación humana no ligada a estos argumentos para ${effect} (MISMATCH).`);
            }
            return { via: 'grant', digest };
        }
        const check = approvalGrants.validate(ctx.grant.token, binding);
        if (check.ok !== true) {
            const reason = (check as { ok: false; reason: string }).reason;
            throw new EffectDeniedError(
                `grant inválido para ${effect} (${reason}; emitido por ${ctx.issuedBy}). ` +
                `Sin reintento: cada efecto requiere su propia aprobación ligada a sus argumentos exactos.`
            );
        }
        return { via: 'grant', digest };
    }

    const { actionExecutor } = await import('../actionExecutor');
    const action = {
        id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        agentId: origin,
        type: policy.actionType as any,
        payload: { effect, args: bindingArgsFor(effect, args) } as any,
        status: 'PENDING' as any,
        timestamp: Date.now(),
        requiresApproval: true
    };
    console.warn(`[EFFECT_GATE] ⏸️ ${effect} from ${origin} requires human confirmation (${policy.category}${policy.walletBearing ? ', wallet-bearing' : ''}). (scoped request may be unavailable; no pending is claimed yet)`);
    const approved = await actionExecutor.requestConfirmation(
        action,
        `${describeEffect(effect, args)}\nOrigen: ${origin}`
    );
    if (!approved) {
        console.warn(`[EFFECT_GATE] ⛔ ${effect} explicitly rejected (origin: ${origin})`);
        throw new EffectDeniedError(
            `efecto "${effect}" sin consentimiento: confirmación rechazada explícitamente (${origin}).`
        );
    }
    console.log(`[EFFECT_GATE] ✅ ${effect} approved by human confirmation (origin: ${origin})`);
    return { via: 'human-approval', digest };
}
