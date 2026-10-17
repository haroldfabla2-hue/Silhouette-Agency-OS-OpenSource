/**
 * PR-K: Local daily quota ledger for free-tier LLM providers.
 *
 * Live incident 2026-10-16: autonomous loops (evolution, QA, Librarian,
 * introspection) burned the Gemini free-tier daily bucket (~500 req/model)
 * by ~17:52; every further attempt hit a real 429, tripped the circuit
 * breaker, and the loops re-enqueued - a retry storm that kept chat
 * degraded for hours.
 *
 * Root fix: count attempts locally per (provider, model, day) and FAIL
 * FAST with an honest QUOTA_BUDGET_EXCEEDED before burning a real API
 * call. The provider chains treat that as a quota signal and degrade to
 * the next free leg immediately - no 429 storm, no circuit flapping.
 *
 * Day boundary: Google resets free-tier quotas at midnight US Pacific,
 * so the ledger day key is the America/Los_Angeles date.
 *
 * Fail-open on ledger errors? NO - fail-closed would block chat on a
 * corrupt ledger; the ledger is a protection, not a gate. A broken
 * ledger logs loudly and allows the call (the provider's own 429 and
 * the circuit breaker remain as the safety net).
 */
import fs from 'fs';
import path from 'path';

export interface QuotaStatus {
    allowed: boolean;
    used: number;
    budget: number;
    day: string;
}

const DEFAULT_BUDGET = 450; // generous default; real per-model free limits vary wildly
// (live 2026-10-17: gemini-3.8-flash = 20/day, gemini-3.1-flash-lite = much larger).
// Set QUOTA_DAILY_BUDGET_<PROVIDER>_<MODEL> to match the real limit of each model.

function dayKey(now: Date = new Date()): string {
    // America/Los_Angeles calendar day (Google's quota reset boundary)
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
}

export class QuotaLedger {
    private readonly file: string;

    constructor(filePath?: string) {
        this.file = filePath || path.join(process.cwd(), 'data', 'quota-ledger.json');
    }

    private read(): Record<string, number> {
        try {
            if (!fs.existsSync(this.file)) return {};
            return JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        } catch (e: any) {
            console.warn(`[QUOTA] ledger unreadable (${e.message}) - allowing call, provider 429 remains as net`);
            return {};
        }
    }

    private write(data: Record<string, number>): void {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(data));
        } catch (e: any) {
            console.warn(`[QUOTA] ledger write failed (${e.message}) - count lost, call unaffected`);
        }
    }

    private key(provider: string, model: string): string {
        return `${dayKey()}:${provider}:${model}`;
    }

    /**
     * Budget resolution, most specific first:
     *   QUOTA_DAILY_BUDGET_<PROVIDER>_<MODEL>  (e.g. QUOTA_DAILY_BUDGET_GEMINI_GEMINI_3_8_FLASH=15)
     *   QUOTA_DAILY_BUDGET_<PROVIDER>
     *   QUOTA_DAILY_BUDGET
     *   default (450)
     * Per-model matters: measured live 2026-10-17, gemini-3.8-flash free tier
     * is 20 requests/day while gemini-3.1-flash-lite has a far larger bucket -
     * one global number cannot protect both.
     */
    budgetFor(provider: string, model?: string): number {
        const perModel = model
            ? Number(process.env[`QUOTA_DAILY_BUDGET_${provider.toUpperCase()}_${model.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]?.trim())
            : NaN;
        if (Number.isFinite(perModel) && perModel > 0) return Math.floor(perModel);
        const perProvider = Number(process.env[`QUOTA_DAILY_BUDGET_${provider.toUpperCase()}`]?.trim());
        if (Number.isFinite(perProvider) && perProvider > 0) return Math.floor(perProvider);
        const env = Number(process.env.QUOTA_DAILY_BUDGET?.trim());
        if (Number.isFinite(env) && env > 0) return Math.floor(env);
        return DEFAULT_BUDGET;
    }

    /** Record one attempt BEFORE the API call - attempts are what quota charges. */
    recordAttempt(provider: string, model: string): QuotaStatus {
        const budget = this.budgetFor(provider, model);
        const data = this.read();
        const key = this.key(provider, model);
        const used = (data[key] || 0) + 1;
        // prune old day keys so the file stays tiny
        const today = dayKey();
        for (const k of Object.keys(data)) if (!k.startsWith(today)) delete data[k];
        data[key] = used;
        this.write(data);
        return { allowed: used <= budget, used, budget, day: today };
    }

    status(provider: string, model: string): QuotaStatus {
        const budget = this.budgetFor(provider, model);
        const used = this.read()[this.key(provider, model)] || 0;
        return { allowed: used < budget, used, budget, day: dayKey() };
    }
}

export const quotaLedger = new QuotaLedger();
