/**
 * Stagehand perception layer ("eyes with AI") for the browser tools.
 *
 * Contract:
 *  - REAL: STAGEHAND_MODEL and STAGEHAND_MODEL_API_KEY are configured (and, for the remote browser,
 *    BROWSERBASE_API_KEY). Calls go to the real Stagehand runtime and the real model.
 *  - UNAVAILABLE: anything missing. The status carries the exact missing settings. Callers fall back
 *    to the built-in engine (provider "builtin"); nothing is ever simulated here.
 *  - Every state-changing step goes through the same payment/commitment gate as the built-in engine,
 *    BEFORE any interaction, and is recorded in the audit ledger.
 *
 * Nothing is hardcoded: model, keys, browser kind and headless mode come from the environment.
 * Stagehand owns its own browser session (it is not the built-in Playwright session).
 */

import { requiresPaymentApproval, ClickDescriptor } from './paymentGate';

export type PerceptionStatus = 'REAL' | 'UNAVAILABLE';

export interface StagehandSettings {
    model: string;
    modelApiKey: string;
    browser: 'local' | 'browserbase';
    browserbaseApiKey?: string;
    headless: boolean;
}

export interface StagehandStatus {
    status: PerceptionStatus;
    reason?: string;
    /** Environment variables that must be set to reach REAL. */
    missing: string[];
    settings?: StagehandSettings;
}

/** Pure: derive the status from an environment. No I/O. */
export function resolveStagehandStatus(env: Record<string, string | undefined> = process.env): StagehandStatus {
    const missing: string[] = [];
    const model = (env.STAGEHAND_MODEL || '').trim();
    const modelApiKey = (env.STAGEHAND_MODEL_API_KEY || '').trim();
    if (!model) missing.push('STAGEHAND_MODEL');
    if (!modelApiKey) missing.push('STAGEHAND_MODEL_API_KEY');

    const browserRaw = (env.STAGEHAND_BROWSER || 'local').trim().toLowerCase();
    if (browserRaw !== 'local' && browserRaw !== 'browserbase') {
        return { status: 'UNAVAILABLE', reason: `STAGEHAND_BROWSER must be "local" or "browserbase" (got "${browserRaw}")`, missing: ['STAGEHAND_BROWSER'] };
    }
    const browserbaseApiKey = (env.BROWSERBASE_API_KEY || '').trim();
    if (browserRaw === 'browserbase' && !browserbaseApiKey) missing.push('BROWSERBASE_API_KEY');

    if (missing.length) {
        return { status: 'UNAVAILABLE', reason: `Stagehand is not configured: missing ${missing.join(', ')}`, missing };
    }
    return {
        status: 'REAL',
        missing: [],
        settings: {
            model,
            modelApiKey,
            browser: browserRaw,
            browserbaseApiKey: browserbaseApiKey || undefined,
            headless: (env.STAGEHAND_HEADLESS || 'true').toLowerCase() !== 'false',
        },
    };
}

/** Minimal surface of the Stagehand instance that this layer uses. */
export interface StagehandLike {
    act(instruction: any): Promise<any>;
    observe(instruction?: string): Promise<any>;
    extract(instruction: string, schema?: any): Promise<any>;
    close(): Promise<void>;
    browser?: { context?: { activePage?: () => Promise<any>; newPage?: (url?: string) => Promise<any>; pages?: () => Promise<any[]> } };
}

/** Creates a live Stagehand instance from validated settings. Replaceable in tests ONLY. */
export type StagehandFactory = (s: StagehandSettings) => Promise<StagehandLike>;

export const realStagehandFactory: StagehandFactory = async (s) => {
    const sdk: any = await import('@browserbasehq/stagehand');
    const browser = s.browser === 'browserbase'
        ? await sdk.browserbase.launch({ apiKey: s.browserbaseApiKey })
        : await sdk.localBrowser.launch({ headless: s.headless });
    return await sdk.Stagehand.create({
        browser,
        model: { modelName: s.model, apiKey: s.modelApiKey },
    });
};

export interface PerceivedAction { description: string; selector?: string; method?: string }

export interface PerceptionResult {
    /** "stagehand" when the real runtime answered; "builtin" is set by the caller that falls back. */
    provider: 'stagehand';
    status: PerceptionStatus;
    success: boolean;
    action: string;
    actions?: PerceivedAction[];
    data?: any;
    url?: string;
    error?: string;
    securityGated?: boolean;
    reason?: string;
    missing?: string[];
}

export type ApprovalFn = (d: ClickDescriptor) => Promise<boolean>;
export type AuditFn = (a: { actionType: string; description: string; url?: string }) => Promise<void>;

export class StagehandPerception {
    private instance: StagehandLike | null = null;
    private starting: Promise<StagehandLike> | null = null;

    constructor(
        private readonly env: () => Record<string, string | undefined> = () => process.env,
        private readonly factory: StagehandFactory = realStagehandFactory,
        private approve: ApprovalFn = async () => false,
        private audit: AuditFn = async () => { /* no ledger injected */ },
    ) {}

    public setApprovalProvider(fn: ApprovalFn): void { this.approve = fn; }
    public setAuditSink(fn: AuditFn): void { this.audit = fn; }

    public status(): StagehandStatus { return resolveStagehandStatus(this.env()); }

    private unavailable(action: string, st: StagehandStatus): PerceptionResult {
        return { provider: 'stagehand', status: 'UNAVAILABLE', success: false, action, error: st.reason, reason: st.reason, missing: st.missing };
    }

    private async session(st: StagehandStatus): Promise<StagehandLike> {
        if (this.instance) return this.instance;
        if (!this.starting) {
            this.starting = this.factory(st.settings!)
                .then(i => { this.instance = i; return i; })
                .finally(() => { this.starting = null; });
        }
        return this.starting;
    }

    private async currentUrl(s: StagehandLike): Promise<string | undefined> {
        try { return (await s.browser?.context?.activePage?.())?.url?.(); } catch { return undefined; }
    }

    /** Open a URL in the Stagehand session. */
    public async goto(url: string): Promise<PerceptionResult> {
        const action = `goto(${url})`;
        const st = this.status();
        if (st.status !== 'REAL') return this.unavailable(action, st);
        try {
            const s = await this.session(st);
            const ctx: any = s.browser?.context;
            let page = await ctx?.activePage?.();
            if (!page) page = await ctx?.newPage?.();
            if (!page) throw new Error('Stagehand returned no page');
            await page.goto(url);
            await this.record({ actionType: 'goto', description: url, url });
            return { provider: 'stagehand', status: 'REAL', success: true, action, url: page.url?.() ?? url };
        } catch (e: any) {
            return { provider: 'stagehand', status: 'REAL', success: false, action, error: String(e?.message || e) };
        }
    }

    /** Read-only: what can be done on the page, in the model's words. */
    public async perceive(instruction?: string): Promise<PerceptionResult> {
        const action = `perceive(${instruction ?? ''})`;
        const st = this.status();
        if (st.status !== 'REAL') return this.unavailable(action, st);
        try {
            const s = await this.session(st);
            const res = await s.observe(instruction);
            const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
            return {
                provider: 'stagehand', status: 'REAL', success: true, action, url: await this.currentUrl(s),
                actions: list.map(a => ({ description: String(a.description ?? ''), selector: a.selector, method: a.method })),
            };
        } catch (e: any) {
            return { provider: 'stagehand', status: 'REAL', success: false, action, error: String(e?.message || e) };
        }
    }

    /** Read-only structured extraction. */
    public async extract(instruction: string, schema?: any): Promise<PerceptionResult> {
        const action = `extract(${instruction})`;
        const st = this.status();
        if (st.status !== 'REAL') return this.unavailable(action, st);
        try {
            const s = await this.session(st);
            const res = schema ? await s.extract(instruction, schema) : await s.extract(instruction);
            return { provider: 'stagehand', status: 'REAL', success: true, action, url: await this.currentUrl(s), data: res?.data ?? res };
        } catch (e: any) {
            return { provider: 'stagehand', status: 'REAL', success: false, action, error: String(e?.message || e) };
        }
    }

    /**
     * Act on the page. Two-phase so the gate sees the real target BEFORE anything is clicked:
     * observe the instruction, gate on the instruction and on every candidate description, then execute.
     */
    public async act(instruction: string): Promise<PerceptionResult> {
        const action = `act(${instruction})`;
        const st = this.status();
        if (st.status !== 'REAL') return this.unavailable(action, st);
        try {
            const s = await this.session(st);
            const url = await this.currentUrl(s);
            const observed = await s.observe(instruction);
            const candidates: any[] = Array.isArray(observed) ? observed : (observed?.data ?? []);
            if (!candidates.length) {
                return { provider: 'stagehand', status: 'REAL', success: false, action, url, error: `No element matches "${instruction}"` };
            }
            const target = candidates[0];
            const descriptor: ClickDescriptor = {
                instruction,
                elementText: String(target.description ?? ''),
                elementType: target.method,
                url,
                elementUnknown: !target.description,
            };
            const needsApproval = requiresPaymentApproval(descriptor)
                || candidates.some(c => requiresPaymentApproval({ instruction, elementText: String(c.description ?? ''), url }));
            if (needsApproval) {
                let ok = false;
                try { ok = await this.approve(descriptor); } catch { ok = false; }
                if (!ok) {
                    await this.record({ actionType: 'act_blocked', description: instruction, url });
                    return { provider: 'stagehand', status: 'REAL', success: false, action, url, securityGated: true, error: 'Blocked: payment/commitment action requires explicit human approval.' };
                }
            }
            const res = await s.act(target);
            const data = res?.data ?? res;
            const ok = data?.success !== false;
            await this.record({ actionType: 'act', description: instruction, url });
            return {
                provider: 'stagehand', status: 'REAL', success: ok, action, url: await this.currentUrl(s),
                actions: [{ description: String(target.description ?? ''), selector: target.selector, method: target.method }],
                error: ok ? undefined : String(data?.message || 'Stagehand reported the action did not succeed'),
            };
        } catch (e: any) {
            return { provider: 'stagehand', status: 'REAL', success: false, action, error: String(e?.message || e) };
        }
    }

    /** Audit failure must never turn a completed action into a reported failure, nor hide behind it. */
    private async record(a: { actionType: string; description: string; url?: string }): Promise<void> {
        try { await this.audit(a); } catch (e: any) { console.warn('[StagehandPerception] audit record failed:', String(e?.message || e)); }
    }

    public async close(): Promise<void> {
        const s = this.instance;
        this.instance = null;
        if (s) { try { await s.close(); } catch { /* already closed */ } }
    }
}
