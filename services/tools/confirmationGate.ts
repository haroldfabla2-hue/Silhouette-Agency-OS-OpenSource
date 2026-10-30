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
 * v3 (R8): records live in the durable ConsentLedger (tmp+rename, 0600,
 * cross-process lock). Expiry-without-decision is EXPIRED, never a human
 * rejection. Execution consumes a single atomic permit (APPROVED -> CONSUMED
 * with receipt): two concurrent final consumers - even in different
 * processes - get exactly one execution; the loser is told the action was
 * ALREADY_CONSUMED instead of executing or silently pending again. An
 * expired proposal can be re-offered as a NEW pending with full provenance;
 * explicit rejections and consumed permits are never re-offered.
 */
import { createHash, randomInt } from 'node:crypto';
import * as path from 'node:path';
import { ConsentLedger, type ConsentRecord, type ConsentStatus } from '../security/consentLedger';

export type PendingStatus = ConsentStatus;
export type PendingEffect = ConsentRecord;

export type GateDecision =
    | { action: 'EXECUTE' }
    | { action: 'PENDING'; pending: PendingEffect }
    | { action: 'REJECTED'; pending: PendingEffect }
    | { action: 'ALREADY_CONSUMED' }
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
     * this call and the user is told the truth, never re-asked to confirm an
     * action that already ran), or BLOCKED_NO_PRINCIPAL when no
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
                if (permit.result === 'CONSUMED') return { action: 'EXECUTE' };
                if (permit.result === 'LOST') return { action: 'ALREADY_CONSUMED' };
                if (permit.result === 'NOT_APPROVED') {
                    // Status changed between the fresh read and the lock
                    // (concurrent decision): report the CURRENT truth.
                    const current = this.ledger.get(existing.token, now);
                    if (current?.status === 'PENDING') return { action: 'PENDING', pending: current };
                    if (current?.status === 'REJECTED') return { action: 'REJECTED', pending: current };
                    if (current?.status === 'CONSUMED') return { action: 'ALREADY_CONSUMED' };
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
            return `[CONFIRM_GATE] La acción ${token} ya fue ejecutada una vez. No se volverá a ejecutar sin una nueva confirmación explícita.`;
        }
        if (entry.status !== 'PENDING') {
            return `[CONFIRM_GATE] La acción ${token} ya fue ${entry.status === 'APPROVED' ? 'confirmada' : 'rechazada'} antes.`;
        }
        if (verb === 'confirmar' || verb === 'confirm') {
            this.ledger.update(token, { status: 'APPROVED', approvedAt: now });
            return `[CONFIRM_GATE] ✅ Acción ${token} (${entry.tool}) confirmada por el usuario. Reemite la llamada con argumentos IDÉNTICOS para ejecutarla UNA vez.`;
        }
        this.ledger.update(token, { status: 'REJECTED', rejectedAt: now });
        return `[CONFIRM_GATE] ❌ Acción ${token} (${entry.tool}) rechazada por el usuario. No la reintentes; si el usuario cambia de opinión, él lo pedirá de nuevo.`;
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
        const result = this.ledger.reoffer(token, { token: this.newToken(), expiresAt: now + TTL_MS }, now);
        if (!result.ok) {
            const why = result.reason === 'EXPLICITLY_REJECTED'
                ? 'fue rechazada explícitamente y no se reofrece; si cambiaste de opinión, pide la acción de nuevo'
                : result.reason === 'ALREADY_CONSUMED'
                    ? 'ya fue ejecutada una vez; una repetición es una acción nueva que debes pedir'
                    : 'aún no ha expirado';
            return `[CONFIRM_GATE] La acción ${token} no se puede reofrecer: ${why}.`;
        }
        return `[CONFIRM_GATE] 🔁 Acción reofrecida como ${result.record.token} (original ${token}, creada ${new Date(entry.createdAt).toISOString()}). Revisa el resumen COMPLETO y responde "CONFIRMAR ${result.record.token}" para ejecutarla una vez o "RECHAZAR ${result.record.token}" para descartarla.\n${result.record.summary}`;
    }

    public pendingCount(): number { return this.active(Date.now()).length; }
}

export const confirmationGate = new ConfirmationGate();
