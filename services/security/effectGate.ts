/**
 * EFFECT GATE v2 - specific, single-use authority for external / wallet-
 * bearing effects, on every code path.
 *
 * Review 2026-10-23 (v1 rejected): provenance contexts ("user-chat",
 * "user-http") were NOT consent - an inherited chat context would have let
 * generate_image/video pass with no approval. v2 removes every context-based
 * pass. The ONLY things that let an effect run:
 *
 *  1. A SINGLE-USE grant bound to effect + EXACT canonical args
 *     (ApprovalGrantStore: consume-once, timing-safe, expiring). Issued only:
 *     a. by chatToolIntegration AFTER confirmationGate's EXECUTE decision
 *        (explicit "CONFIRMAR <token>" from the authenticated principal in
 *        the same conversation, exact args - pre-existing chat mechanism,
 *        now covering all gated effects);
 *     b. by an authenticated HTTP route whose request body IS the principal's
 *        explicit specification of those exact args (e.g. composing an email
 *        and clicking send);
 *     c. internally, after a human approves at /v1/autonomy/confirmations
 *        (actionExecutor), for the single approved execution.
 *  2. Nothing else. No chat kind, no http kind, no generic "confirmed".
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
    console.log(`[EFFECT_GATE] 🎟️ grant issued for ${effect} by ${issuedBy} (single-use, args-bound)`);
    return { grant: { token: grant.token, binding }, validated: new Set(), issuedBy };
}

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
 * With a context: the grant is consumed against THIS effect+args. A digest
 * already validated in this same chain passes (the layers of ONE approved
 * execution). Anything else - different args, replay, expired, foreign token
 * - denies. One grant never covers a second piece.
 *
 * Without a context: human approval via actionExecutor (pending at
 * /v1/autonomy/confirmations). Approval executes this piece once; rejection
 * or timeout denies.
 */
export async function ensureEffectConsent(
    effect: EffectKind,
    args: Record<string, any>,
    origin: string
): Promise<ConsentGranted> {
    const policy = EFFECT_POLICIES[effect];

    // CERO COBROS: wallet-bearing provider effects stay blocked unless the
    // operator explicitly authorized uncapped paid generation
    // (security.allowPaidEffects). The system cannot verify per-piece cost
    // upfront, so without that flag there is no verifiable cost cap and the
    // feature remains pending authorization - it does not spend. Fail-closed
    // when the config cannot be read.
    if (policy.walletBearing) {
        let allowed = false;
        try {
            const { configLoader } = await import('../../server/config/configLoader');
            allowed = !!configLoader.getConfig().security?.allowPaidEffects;
        } catch (cfgErr: any) {
            console.error('[EFFECT_GATE] ⛔ could not read security config; paid effect denied (fail-closed):', cfgErr?.message || cfgErr);
        }
        if (!allowed) {
            throw new EffectDeniedError(
                `efecto "${effect}" bloqueado: es de coste y el sistema no puede verificar coste/límite por pieza. ` +
                `Pendiente de autorización del operador (security.allowPaidEffects en silhouette.config.json). No se gastó nada.`
            );
        }
    }

    const binding = effectBinding(effect, args);
    const digest = bindingDigest(binding);
    const ctx = getEffectContext();

    if (ctx) {
        // The layers of ONE approved logical invocation share the exact same
        // normalized digest (mediaService -> imageFactory, executeCapability
        // re-entry). A second piece - different args - never matches.
        if (ctx.validated.has(digest)) return { via: 'grant', digest };
        const check = approvalGrants.consume(ctx.grant.token, binding);
        if (!check.ok) {
            throw new EffectDeniedError(
                `grant inválido para ${effect} (${check.reason}; emitido por ${ctx.issuedBy}). ` +
                `Sin reintento: cada efecto requiere su propia aprobación ligada a sus argumentos exactos.`
            );
        }
        ctx.validated.add(digest);
        console.log(`[EFFECT_GATE] ✅ ${effect} grant consumed (issued by ${ctx.issuedBy}, origin: ${origin})`);
        return { via: 'grant', digest };
    }

    const { actionExecutor } = await import('../actionExecutor');
    const action = {
        id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        agentId: origin,
        type: policy.actionType as any,
        payload: { effect, args: bindingArgsFor(effect, args) },
        status: 'PENDING' as any,
        timestamp: Date.now(),
        requiresApproval: true
    };
    console.warn(`[EFFECT_GATE] ⏸️ ${effect} from ${origin} requires human confirmation (${policy.category}${policy.walletBearing ? ', wallet-bearing' : ''}). Pending at /v1/autonomy/confirmations`);
    const approved = await actionExecutor.requestConfirmation(
        action,
        `${describeEffect(effect, args)}\nOrigen: ${origin}`
    );
    if (!approved) {
        console.warn(`[EFFECT_GATE] ⛔ ${effect} denied or confirmation expired (origin: ${origin})`);
        throw new EffectDeniedError(
            `efecto "${effect}" sin consentimiento: rechazado o expiró la confirmación humana (${origin}).`
        );
    }
    console.log(`[EFFECT_GATE] ✅ ${effect} approved by human confirmation (origin: ${origin})`);
    return { via: 'human-approval', digest };
}
