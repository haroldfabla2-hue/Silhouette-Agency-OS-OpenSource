/**
 * CONFIRMATION GATE - no external effect fires on the model's first call.
 *
 * Live finding (2026-10-17): for CREATOR/ADMIN (the owner), chat tools like
 * send_email executed immediately - a chat message could fire an email in the
 * owner's name with no review. This gate makes external effects two-phase:
 *
 *   1st call (tool + args): nothing executes. The action is summarized and
 *       persisted (survives restarts) and the chat relays the summary and asks
 *       for explicit confirmation.
 *   2nd call (IDENTICAL tool + args, after the user confirms): executes.
 *       Any change to the arguments means a brand new pending action.
 *
 * Anti same-turn-retry: the confirming call must arrive at least
 * CONFIRM_GATE_MIN_AGE_MS (default 5s) after the pending was created - a user
 * needs time to read and answer; an immediate model retry keeps waiting.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PendingEffect {
    key: string;
    tool: string;
    args: Record<string, any>;
    summary: string;
    createdAt: number;
    expiresAt: number;
}

/** Chat tools with irreversible external effects. Payments are already gated
 *  human-in-the-loop by financialVault; GUESTs are blocked upstream. */
export const EXTERNAL_EFFECT_TOOLS = new Set(['send_email', 'github_create_pr']);

const DATA_DIR = process.env.CONFIRMATION_GATE_DIR || path.join(process.cwd(), 'data');
const STORE = path.join(DATA_DIR, 'pending-effects.json');
const TTL_MS = 30 * 60 * 1000;
const MIN_AGE_MS = Number(process.env.CONFIRM_GATE_MIN_AGE_MS ?? 5000) || 5000;

const canonical = (args: Record<string, any>): string => {
    const sorted: Record<string, any> = {};
    for (const k of Object.keys(args).sort()) sorted[k] = args[k];
    return JSON.stringify(sorted);
};

export const effectKey = (tool: string, args: Record<string, any>): string =>
    createHash('sha256').update(`${tool}:${canonical(args)}`).digest('hex').slice(0, 24);

export function summarizeEffect(tool: string, args: Record<string, any>): string {
    if (tool === 'send_email') {
        return `Para: ${args.to}\nAsunto: ${args.subject}\nCuerpo:\n${String(args.body ?? '').slice(0, 500)}`;
    }
    if (tool === 'github_create_pr') {
        return `Pull request: "${args.title}" (${args.head ?? args.branch ?? '?'} -> ${args.base ?? 'main'})${args.repo ? ` en ${args.repo}` : ''}`;
    }
    return `${tool}(${canonical(args).slice(0, 300)})`;
}

class ConfirmationGate {
    private pending = new Map<string, PendingEffect>();
    private loaded = false;

    private load(): void {
        if (this.loaded) return;
        this.loaded = true;
        try {
            const rows = JSON.parse(fs.readFileSync(STORE, 'utf8')) as PendingEffect[];
            const now = Date.now();
            for (const r of rows) if (r && r.key && r.expiresAt > now) this.pending.set(r.key, r);
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

    /**
     * Returns the PendingEffect when this call must NOT execute yet (first time
     * seen, or a too-fresh retry). Returns null when the call is the confirmation
     * (identical repeat after MIN_AGE_MS) and execution may proceed.
     */
    public gate(tool: string, args: Record<string, any>): PendingEffect | null {
        this.load();
        const now = Date.now();
        const key = effectKey(tool, args);
        const existing = this.pending.get(key);
        if (existing && existing.expiresAt > now && now - existing.createdAt >= MIN_AGE_MS) {
            this.pending.delete(key);
            this.save();
            return null; // confirmed: execute
        }
        if (existing && existing.expiresAt > now) return existing; // too fresh: keep waiting
        const effect: PendingEffect = { key, tool, args, summary: summarizeEffect(tool, args), createdAt: now, expiresAt: now + TTL_MS };
        this.pending.set(key, effect);
        this.save();
        return effect;
    }

    public pendingCount(): number { this.load(); return this.pending.size; }
}

export const confirmationGate = new ConfirmationGate();
