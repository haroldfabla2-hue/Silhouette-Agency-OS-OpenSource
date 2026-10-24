/**
 * CONFIRMATION GATE v2 - external effects execute only after an EXPLICIT,
 * AUTHENTICATED human yes.
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
 */
import { createHash, randomInt } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type PendingStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PendingEffect {
    token: string;
    key: string;                  // sha256(tool + canonical args)
    tool: string;
    args: Record<string, any>;
    summary: string;              // FULL action content for user review
    principalId: string;          // authenticated user that triggered it
    conversationId: string;       // conversation/session it belongs to
    status: PendingStatus;
    createdAt: number;
    expiresAt: number;
    approvedAt?: number;
    rejectedAt?: number;
}

export type GateDecision =
    | { action: 'EXECUTE' }
    | { action: 'PENDING'; pending: PendingEffect }
    | { action: 'REJECTED'; pending: PendingEffect }
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
const STORE = path.join(DATA_DIR, 'pending-effects.json');
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
    private pending = new Map<string, PendingEffect>(); // by token
    private loaded = false;

    private load(): void {
        if (this.loaded) return;
        this.loaded = true;
        try {
            const rows = JSON.parse(fs.readFileSync(STORE, 'utf8')) as PendingEffect[];
            const now = Date.now();
            for (const r of rows) {
                if (!r || !r.token) continue;
                const relevant = r.status === 'REJECTED' ? (now - (r.rejectedAt || 0)) < REJECT_COOLDOWN_MS : r.expiresAt > now;
                if (relevant) this.pending.set(r.token, r);
            }
        } catch { /* no store yet */ }
    }

    private save(): void {
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(STORE, JSON.stringify([...this.pending.values()], null, 1), { mode: 0o600 });
        } catch (e: any) {
            console.warn('[CONFIRM_GATE] persist failed:', e?.message);
        }
    }

    private newToken(): string {
        let token = '';
        do {
            token = Array.from({ length: 6 }, () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)]).join('');
        } while (this.pending.has(token));
        return token;
    }

    private findByAction(key: string, principalId: string, conversationId: string): PendingEffect | undefined {
        for (const p of this.pending.values()) {
            if (p.key === key && p.principalId === principalId && p.conversationId === conversationId) return p;
        }
        return undefined;
    }

    /**
     * Decision for a tool call. EXECUTE only when a pending action for THIS
     * principal + THIS conversation + THESE EXACT args was explicitly approved
     * by the user - then it is consumed (one-time). Otherwise PENDING (created
     * or existing), REJECTED (inside cooldown), or BLOCKED_NO_PRINCIPAL when no
     * authenticated principal/conversation exists to bind an approval to.
     */
    public check(tool: string, args: Record<string, any>, principalId?: string, conversationId?: string): GateDecision {
        this.load();
        if (!principalId || !conversationId) return { action: 'BLOCKED_NO_PRINCIPAL' };
        const now = Date.now();
        const key = effectKey(tool, args);
        const existing = this.findByAction(key, principalId, conversationId);
        if (existing) {
            if (existing.status === 'REJECTED' && now - (existing.rejectedAt || 0) < REJECT_COOLDOWN_MS) {
                return { action: 'REJECTED', pending: existing };
            }
            if (existing.status === 'REJECTED') this.pending.delete(existing.token); // cooldown over
            else if (existing.expiresAt <= now) this.pending.delete(existing.token); // expired
            else if (existing.status === 'APPROVED') {
                this.pending.delete(existing.token); // one-time consumption
                this.save();
                return { action: 'EXECUTE' };
            } else {
                return { action: 'PENDING', pending: existing }; // awaiting the user's explicit yes
            }
        }
        const pending: PendingEffect = {
            token: this.newToken(), key, tool, args,
            summary: summarizeEffect(tool, args),
            principalId, conversationId,
            status: 'PENDING', createdAt: now, expiresAt: now + TTL_MS
        };
        this.pending.set(pending.token, pending);
        this.save();
        return { action: 'PENDING', pending };
    }

    /**
     * Handles an authenticated user message. Returns an acknowledgement string
     * when the message was a gate command (CONFIRMAR/RECHAZAR <token>) that
     * matched a pending action of THIS principal in THIS conversation, else null.
     */
    public handleUserCommand(message: string, principalId: string, conversationId: string): string | null {
        this.load();
        const m = message.match(/\b(confirmar|confirm|rechazar|reject|cancelar)\s+([A-Za-z0-9]{6})\b/i);
        if (!m) return null;
        const verb = m[1].toLowerCase();
        const token = m[2].toUpperCase();
        const entry = this.pending.get(token);
        if (!entry) return null; // not a gate token - normal chat handles it
        const now = Date.now();
        if (entry.principalId !== principalId || entry.conversationId !== conversationId) {
            return `[CONFIRM_GATE] El token ${token} no pertenece a esta conversación o usuario. No se aplicó nada.`;
        }
        if (entry.expiresAt <= now && entry.status !== 'REJECTED') {
            this.pending.delete(token);
            this.save();
            return `[CONFIRM_GATE] La acción ${token} expiró. Si aún la quieres, pide al asistente que la prepare de nuevo.`;
        }
        if (entry.status !== 'PENDING') {
            return `[CONFIRM_GATE] La acción ${token} ya fue ${entry.status === 'APPROVED' ? 'confirmada' : 'rechazada'} antes.`;
        }
        if (verb === 'confirmar' || verb === 'confirm') {
            entry.status = 'APPROVED';
            entry.approvedAt = now;
            this.save();
            return `[CONFIRM_GATE] ✅ Acción ${token} (${entry.tool}) confirmada por el usuario. Reemite la llamada con argumentos IDÉNTICOS para ejecutarla UNA vez.`;
        }
        entry.status = 'REJECTED';
        entry.rejectedAt = now;
        this.save();
        return `[CONFIRM_GATE] ❌ Acción ${token} (${entry.tool}) rechazada por el usuario. No la reintentes; si el usuario cambia de opinión, él lo pedirá de nuevo.`;
    }

    public pendingCount(): number { this.load(); return this.pending.size; }
}

export const confirmationGate = new ConfirmationGate();
