/**
 * CONFIRMATION GATE v3 - external effects execute only after an EXPLICIT,
 * AUTHENTICATED human yes, now on a DURABLE consent ledger.
 *
 * v1 flaw (review 2026-10-17): any identical second call after 5s executed -
 * time passing is not consent, and nothing bound the approval to the person
 * who gave it. v2: the first call stores a pending action with a one-time
 * token and relays the FULL action (recipients + complete content). The user
 * confirms or rejects by replying "CONFIRMAR <token>" / "RECHAZAR <token>" in
 * the SAME conversation, from the SAME authenticated principal that requested
 * it. Only then does an identical re-issued call execute - once. Any change
 * to the arguments is a new action requiring its own confirmation. Actions
 * expire; rejected actions are refused during a cooldown.
 *
 * v3 (R8): records live in the durable event-sourced ConsentLedger
 * (append-only JSONL, first-valid-claim-wins, no lock file). Expiry-without-decision is EXPIRED, never a human
 * rejection. Execution consumes a single atomic permit (APPROVED -> CONSUMED
 * with receipt): two concurrent final consumers - even in different
 * processes - get exactly one execution PERMIT; the loser is told its
 * call's permit is ALREADY_CONSUMED instead of executing or silently
 * pending again. Permit consumption is all the gate can prove: whether
 * the winner's EFFECT actually ran is unconfirmed (it may crash after
 * consuming), so nothing downstream may claim 'already executed'. An
 * expired proposal can be re-offered as a NEW pending with full provenance;
 * explicit rejections and consumed permits are never re-offered.
 */
import { createHash, randomInt } from 'node:crypto';
import * as path from 'node:path';
import { ConsentLedger, type ConsentRecord, type ConsentStatus } from '../security/consentLedger';

export type PendingStatus = ConsentStatus;
export type PendingEffect = ConsentRecord;

export type GateDecision =
    | { action: 'EXECUTE'; token: string; receipt: string }
    | { action: 'PENDING'; pending: PendingEffect }
    | { action: 'REJECTED'; pending: PendingEffect }
    | { action: 'ALREADY_CONSUMED'; token: string }
    | { action: 'BLOCKED_NO_PRINCIPAL' };

/** Chat tools with external or wallet-bearing effects. Payments are already
 *  gated human-in-the-loop by financialVault; GUESTs are blocked upstream.
 *  Image/video/voice generation is wallet-bearing (cloud providers) and is
 *  confirmed per exact call, like email: no free generation from chat. */
export const EXTERNAL_EFFECT_TOOLS = new Set([
    'send_email',
    'github_create_pr',
    'generate_image',
    'generate_video',
    'generate_voice'
]);

const DATA_DIR = process.env.CONFIRMATION_GATE_DIR || path.join(process.cwd(), 'data');
const TTL_MS = Number(process.env.CONFIRM_GATE_TTL_MS ?? 15 * 60 * 1000) || 15 * 60 * 1000;
const REJECT_COOLDOWN_MS = Number(process.env.CONFIRM_GATE_REJECT_COOLDOWN_MS ?? 10 * 60 * 1000) || 10 * 60 * 1000;
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

const canonical = (args: Record<string, any>): string => {
    const sorted: Record<string, any> = {};
    for (const k of Object.keys(args).sort()) sorted[k] = args[k];
    return JSON.stringify(sorted);
};

export const effectKey = (tool: string, args: Record<string, any>): string =>
    createHash('sha256').update(`${tool}:${canonical(args)}`).digest('hex').slice(0, 24);

/** Full action content for user review - the user cannot approve what they
 *  cannot read. Only absurd sizes are capped, and the cap is stated. */
export function summarizeEffect(tool: string, args: Record<string, any>): string {
    const full = (v: any) => {
        const s = String(v ?? '');
        return s.length > 8000 ? s.slice(0, 8000) + `\n[... truncado en pantalla: ${s.length} caracteres totales; el token cubre el contenido COMPLETO]` : s;
    };
    if (tool === 'send_email') {
        return `Para: ${args.to}${args.cc ? `\nCC: ${args.cc}` : ''}\nAsunto: ${args.subject}\nCuerpo:\n${full(args.body)}`;
    }
    if (tool === 'github_create_pr') {
        return `Pull request: "${args.title}" (${args.head ?? args.branch ?? '?'} -> ${args.base ?? 'main'})${args.repo ? ` en ${args.repo}` : ''}\nDescripción:\n${full(args.body)}`;
    }
    if (tool === 'generate_image') {
        return `Generar imagen (coste de proveedor)\nEstilo: ${args.style ?? 'PHOTOREALISTIC'} ${args.aspectRatio ?? ''}\nPrompt: ${full(args.prompt)}`;
    }
    if (tool === 'generate_video') {
        return `Generar vídeo (coste de proveedor)\nMotor: ${args.engine ?? '?'}\nPrompt: ${full(args.prompt)}`;
    }
    if (tool === 'generate_voice') {
        return `Generar voz (coste de proveedor)\nVoz: ${args.voiceId ?? 'default'}\nTexto: ${full(args.text)}`;
    }
    return `${tool}(${full(canonical(args))})`;
}

class ConfirmationGate {
    private ledger = new ConsentLedger(DATA_DIR);

    /** Records still meaningful for NEW decisions: awaiting a decision,
     *  approved-not-consumed, or rejected inside the cooldown. EXPIRED,
     *  CONSUMED and old REJECTED rows stay stored as evidence but never
     *  block or enable a new call. */
    private active(now: number): PendingEffect[] {
        return this.ledger.all(now).filter(r =>
            r.status === 'PENDING' ||
            r.status === 'APPROVED' ||
            (r.status === 'REJECTED' && now - (r.rejectedAt || 0) < REJECT_COOLDOWN_MS));
    }

    private newToken(): string {
        let token = '';
        do {
            token = Array.from({ length: 6 }, () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)]).join('');
        } while (this.ledger.get(token));
        return token;
    }

    private findByAction(key: string, principalId: string, conversationId: string, now: number): PendingEffect | undefined {
        return this.active(now).find(p =>
            p.key === key && p.principalId === principalId && p.conversationId === conversationId);
    }

    /**
     * Decision for a tool call. EXECUTE only when a pending action for THIS
     * principal + THIS conversation + THESE EXACT args was explicitly approved
     * by the user - then the single execution permit is consumed atomically
     * (one-time, cross-process). Outcomes: PENDING (created or existing),
     * REJECTED (inside cooldown), EXECUTE (the one permit), ALREADY_CONSUMED
     * (the record was still APPROVED when read but a concurrent final
     * consumer took the one permit before the lock: NOTHING executed for
     * THIS call, and whether the winner's effect ran is UNCONFIRMED (it may
     * have crashed after consuming) - the user is told exactly that, never
     * re-asked to confirm a spent permit), or BLOCKED_NO_PRINCIPAL when no
     * authenticated principal/conversation exists to bind an approval to.
     * A LATER identical call after consumption (record already CONSUMED when
     * read) is a brand-new pending requiring its own explicit confirmation:
     * the reviewed v2 contract is unchanged.
     */
    public check(tool: string, args: Record<string, any>, principalId?: string, conversationId?: string): GateDecision {
        if (!principalId || !conversationId) return { action: 'BLOCKED_NO_PRINCIPAL' };
        const now = Date.now();
        const key = effectKey(tool, args);
        const existing = this.findByAction(key, principalId, conversationId, now);
        if (existing) {
            if (existing.status === 'REJECTED') {
                return { action: 'REJECTED', pending: existing };
            }
            if (existing.status === 'APPROVED') {
                const permit = this.ledger.consumePermit(existing.token, principalId, conversationId, now);
                if (permit.result === 'CONSUMED') return { action: 'EXECUTE', token: existing.token, receipt: permit.record.consumedBy! };
                if (permit.result === 'LOST') return { action: 'ALREADY_CONSUMED', token: existing.token };
                if (permit.result === 'NOT_APPROVED') {
                    // Status changed between the fresh read and the lock
                    // (concurrent decision): report the CURRENT truth.
                    const current = this.ledger.get(existing.token, now);
                    if (current?.status === 'PENDING') return { action: 'PENDING', pending: current };
                    if (current?.status === 'REJECTED') return { action: 'REJECTED', pending: current };
                    if (current?.status === 'CONSUMED') return { action: 'ALREADY_CONSUMED', token: existing.token };
                    // EXPIRED: fall through to a fresh pending.
                }
                // EXPIRED between decision and execution: fall through and
                // create a fresh pending. WRONG_PRINCIPAL/WRONG_CONVERSATION/
                // UNKNOWN contradict the fresh read above: fail closed with a
                // visible error, never a false "no authenticated principal".
                if (permit.result !== 'EXPIRED' && permit.result !== 'NOT_APPROVED') {
                    throw new Error(`[CONFIRM_GATE] inconsistent permit result ${permit.result} for a record read as APPROVED moments ago; refusing to decide`);
                }
            } else {
                return { action: 'PENDING', pending: existing };
            }
        }
        const pending: PendingEffect = {
            token: this.newToken(), key, tool, args,
            summary: summarizeEffect(tool, args),
            principalId, conversationId,
            status: 'PENDING', createdAt: now, expiresAt: now + TTL_MS
        };
        this.ledger.put(pending);
        return { action: 'PENDING', pending };
    }

    /**
     * Handles an authenticated user message. Returns an acknowledgement string
     * when the message was a gate command (CONFIRMAR/RECHAZAR <token>) that
     * matched a pending action of THIS principal in THIS conversation, else null.
     */
    public handleUserCommand(message: string, principalId: string, conversationId: string): string | null {
        const m = message.match(/\b(confirmar|confirm|rechazar|reject|cancelar|reofrecer|reoffer)\s+([A-Za-z0-9]{6})\b/i);
        if (!m) return null;
        const verb = m[1].toLowerCase();
        const token = m[2].toUpperCase();
        if (verb === 'reofrecer' || verb === 'reoffer') {
            return this.reoffer(token, principalId, conversationId);
        }
        const now = Date.now();
        const entry = this.ledger.get(token, now);
        if (!entry) return null; // not a gate token - normal chat handles it
        if (entry.principalId !== principalId || entry.conversationId !== conversationId) {
            return `[CONFIRM_GATE] El token ${token} no pertenece a esta conversación o usuario. No se aplicó nada.`;
        }
        if (entry.status === 'EXPIRED') {
            return `[CONFIRM_GATE] La acción ${token} expiró sin decisión (no cuenta como rechazo). Si aún la quieres, responde "REOFRECER ${token}" para revisarla de nuevo, o pide la acción de nuevo.`;
        }
        if (entry.status === 'CONSUMED') {
            const outcome = entry.outcome
                ? (entry.outcome.status === 'EXECUTOR_OK'
                    ? 'el ejecutor registró ejecución correcta (su propia observación, no una garantía de entrega)'
                    : `el ejecutor registró FALLO de ejecución${entry.outcome.detail ? ` (${entry.outcome.detail})` : ''}`)
                : 'sin resultado registrado (la ejecución pudo completarse, fallar o no haber ocurrido tras consumir el permiso)';
            return `[CONFIRM_GATE] El permiso de la acción ${token} ya fue consumido (una sola vez); resultado: ${outcome}. Este token no ejecutará nada más: una repetición es una acción nueva que debes pedir.`;
        }
        if (entry.status !== 'PENDING') {
            return `[CONFIRM_GATE] La acción ${token} ya fue ${entry.status === 'APPROVED' ? 'confirmada' : 'rechazada'} antes.`;
        }
        if (verb === 'confirmar' || verb === 'confirm') {
            const after = this.ledger.decide(token, 'APPROVED', principalId, conversationId);
            if (after?.status === 'APPROVED') {
                return `[CONFIRM_GATE] ✅ Acción ${token} (${entry.tool}) confirmada por el usuario. Reemite la llamada con argumentos IDÉNTICOS para ejecutarla UNA vez.`;
            }
            return `[CONFIRM_GATE] Tu confirmación NO se aplicó: la acción ${token} ya está ${this.describeStatus(after)}. No se ejecutó nada desde este mensaje.`;
        }
        const after = this.ledger.decide(token, 'REJECTED', principalId, conversationId);
        if (after?.status === 'REJECTED') {
            return `[CONFIRM_GATE] ❌ Acción ${token} (${entry.tool}) rechazada por el usuario (decisión definitiva). No la reintentes; si el usuario cambia de opinión, él lo pedirá de nuevo.`;
        }
        return `[CONFIRM_GATE] Tu rechazo NO se aplicó: la acción ${token} ya está ${this.describeStatus(after)}. Nada cambió desde este mensaje.`;
    }

    /**
     * Re-offer an EXPIRED action to its original principal + conversation as a
     * NEW pending token with full provenance (reofferOf + original creation
     * time). Only time passing is reversible: explicit rejections and
     * consumed permits are never re-offered. The new token awaits its own
     * explicit CONFIRMAR - re-offering is not approval.
     */
    public reoffer(token: string, principalId: string, conversationId: string): string {
        const now = Date.now();
        const entry = this.ledger.get(token, now);
        if (!entry) return `[CONFIRM_GATE] No existe ninguna acción con el token ${token}.`;
        if (entry.principalId !== principalId || entry.conversationId !== conversationId) {
            return `[CONFIRM_GATE] El token ${token} no pertenece a esta conversación o usuario. No se aplicó nada.`;
        }
        // Token collision (6-char namespace): retry with fresh tokens before
        // giving up; the fold itself is collision-guarded either way.
        let result = this.ledger.reoffer(token, { token: this.newToken(), expiresAt: now + TTL_MS }, now);
        for (let tries = 0; result.ok === false && result.reason === 'TOKEN_COLLISION' && tries < 3; tries++) {
            result = this.ledger.reoffer(token, { token: this.newToken(), expiresAt: now + TTL_MS }, now);
        }
        if (result.ok === false) { // equality narrowing: repo tsconfig has strictNullChecks off, so !result.ok does not discriminate the union
            if (result.reason === 'TOKEN_COLLISION') {
                return `[CONFIRM_GATE] No se pudo reofrecer la acción ${token}: colisión de token repetida. Inténtalo de nuevo; no se cambió nada.`;
            }
            const why = result.reason === 'EXPLICITLY_REJECTED'
                ? 'fue rechazada explícitamente y no se reofrece; si cambiaste de opinión, pide la acción de nuevo'
                : result.reason === 'ALREADY_CONSUMED'
                    ? 'su permiso ya fue consumido y el gate no puede confirmar si el efecto se ejecutó; una repetición es una acción nueva que debes pedir'
                    : result.reason === 'ALREADY_REOFFERED'
                        ? 'ya fue reofrecida y existe un token nuevo vigente; revisa ese aviso'
                        : 'aún no ha expirado';
            return `[CONFIRM_GATE] La acción ${token} no se puede reofrecer: ${why}.`;
        }
        return `[CONFIRM_GATE] 🔁 Acción reofrecida como ${result.record.token} (original ${token}, creada ${new Date(entry.createdAt).toISOString()}). Revisa el resumen COMPLETO y responde "CONFIRMAR ${result.record.token}" para ejecutarla una vez o "RECHAZAR ${result.record.token}" para descartarla.\n${result.record.summary}`;
    }

    private describeStatus(r: PendingEffect | undefined): string {
        if (!r) return 'desconocida';
        switch (r.status) {
            case 'REJECTED': return 'rechazada';
            case 'CONSUMED': return 'con su permiso ya consumido';
            case 'EXPIRED': return `expirada (si aún la quieres, responde "REOFRECER ${r.token}")`;
            case 'PENDING': return 'pendiente';
            default: return r.status;
        }
    }

    /** Record what the permit WINNER observed after spending the permit
     *  (reconciliation evidence; receipt-bound, first record wins, never
     *  rewritten). */
    public recordOutcome(token: string, receipt: string, ok: boolean, detail?: string): boolean {
        return this.ledger.recordOutcome(token, receipt, ok ? 'EXECUTOR_OK' : 'EXECUTOR_FAILED', detail);
    }

    /** The recorded outcome of a consumed permit, if any. Absent = unknown. */
    public outcomeOf(token: string): import('../security/consentLedger').EffectOutcome | undefined {
        return this.ledger.get(token)?.outcome;
    }

    public pendingCount(): number { return this.active(Date.now()).length; }
}

export const confirmationGate = new ConfirmationGate();
