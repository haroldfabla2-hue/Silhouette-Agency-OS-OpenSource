import { describe, it, expect, vi } from 'vitest';
import { resolveStagehandStatus, StagehandPerception, StagehandLike } from '../../services/browser/stagehandPerception';
import { routePerception, BuiltinBrowser } from '../../services/browser/perceptionRouter';

const REAL_ENV = { STAGEHAND_MODEL: 'test/model-x', STAGEHAND_MODEL_API_KEY: 'k-test' };

// Simulated Stagehand runtime: used ONLY in tests.
function fakeRuntime(observed: any[], actResult: any = { data: { success: true, message: 'ok', actionDescription: '', actions: [] } }) {
    const calls: any[] = [];
    const inst: StagehandLike = {
        observe: vi.fn(async (i?: string) => { calls.push(['observe', i]); return { data: observed }; }),
        act: vi.fn(async (a: any) => { calls.push(['act', a]); return actResult; }),
        extract: vi.fn(async (i: string) => { calls.push(['extract', i]); return { data: { title: 'T' } }; }),
        close: vi.fn(async () => {}),
        browser: { context: { activePage: async () => ({ url: () => 'https://shop.example/cart', goto: async () => {} }) } },
    };
    return { inst, calls };
}

function builtin(): BuiltinBrowser & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        goto: async (u) => { calls.push('goto'); return { url: u }; },
        observe: async () => { calls.push('observe'); return [{ id: 1 }]; },
        act: async () => { calls.push('act'); return { success: true }; },
        extract: async () => { calls.push('extract'); return { success: true }; },
    };
}

describe('Stagehand status is driven by configuration only', () => {
    it('UNAVAILABLE with exact missing settings when nothing is configured (regression: Stagehand was installed but unused)', () => {
        const st = resolveStagehandStatus({});
        expect(st.status).toBe('UNAVAILABLE');
        expect(st.missing).toEqual(['STAGEHAND_MODEL', 'STAGEHAND_MODEL_API_KEY']);
    });
    it('REAL with model + key; model and key are never defaulted', () => {
        const st = resolveStagehandStatus(REAL_ENV);
        expect(st.status).toBe('REAL');
        expect(st.settings?.model).toBe('test/model-x');
        expect(resolveStagehandStatus({ STAGEHAND_MODEL: 'm' }).status).toBe('UNAVAILABLE');
        expect(resolveStagehandStatus({ STAGEHAND_MODEL_API_KEY: 'k' }).status).toBe('UNAVAILABLE');
    });
    it('remote browser additionally requires BROWSERBASE_API_KEY; bad browser kind is rejected', () => {
        expect(resolveStagehandStatus({ ...REAL_ENV, STAGEHAND_BROWSER: 'browserbase' }).missing).toEqual(['BROWSERBASE_API_KEY']);
        expect(resolveStagehandStatus({ ...REAL_ENV, STAGEHAND_BROWSER: 'browserbase', BROWSERBASE_API_KEY: 'b' }).status).toBe('REAL');
        expect(resolveStagehandStatus({ ...REAL_ENV, STAGEHAND_BROWSER: 'nope' }).status).toBe('UNAVAILABLE');
    });
});

describe('UNAVAILABLE path: no fake, honest fallback to the built-in engine', () => {
    it('never creates a Stagehand instance and reports UNAVAILABLE', async () => {
        const factory = vi.fn();
        const sp = new StagehandPerception(() => ({}), factory as any);
        const r = await sp.act('click login');
        expect(r.status).toBe('UNAVAILABLE');
        expect(r.success).toBe(false);
        expect(factory).not.toHaveBeenCalled();
    });
    it('router falls back to built-in, labels provider=builtin and explains what is missing', async () => {
        const b = builtin();
        const sp = new StagehandPerception(() => ({}), vi.fn() as any);
        const r = await routePerception('observe', {}, sp, b);
        expect(r.provider).toBe('builtin');
        expect(r.fell_back_from_stagehand).toBe(true);
        expect(r.stagehand_missing).toContain('STAGEHAND_MODEL');
        expect(b.calls).toEqual(['observe']);
    });
});

describe('REAL path (simulated runtime, tests only)', () => {
    it('observe/extract go through the runtime and the builtin engine is not touched', async () => {
        const { inst } = fakeRuntime([{ selector: '#a', description: 'Login button', method: 'click' }]);
        const sp = new StagehandPerception(() => REAL_ENV, async () => inst);
        const b = builtin();
        const o = await routePerception('observe', { instruction: 'login' }, sp, b);
        expect(o.provider).toBe('stagehand');
        expect(o.result.actions[0].description).toBe('Login button');
        const e = await routePerception('extract', { instruction: 'title' }, sp, b);
        expect(e.result.data).toEqual({ title: 'T' });
        expect(b.calls).toEqual([]);
    });
    it('act executes the observed target and is audited', async () => {
        const { inst, calls } = fakeRuntime([{ selector: '#a', description: 'Open settings', method: 'click' }]);
        const audit = vi.fn(async () => {});
        const sp = new StagehandPerception(() => REAL_ENV, async () => inst, async () => false, audit);
        const r = await sp.act('open settings');
        expect(r.success).toBe(true);
        expect(calls.map(c => c[0])).toEqual(['observe', 'act']);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'act' }));
    });
    it('NEGATIVE: a payment/commitment target is NOT clicked without approval (gate runs before act)', async () => {
        const { inst, calls } = fakeRuntime([{ selector: '#pay', description: 'Pay now', method: 'click' }]);
        const sp = new StagehandPerception(() => REAL_ENV, async () => inst, async () => false);
        const r = await sp.act('continue');
        expect(r.success).toBe(false);
        expect(r.securityGated).toBe(true);
        expect(calls.map(c => c[0])).toEqual(['observe']); // act never called
    });
    it('a payment target proceeds only after an explicit human approval', async () => {
        const { inst, calls } = fakeRuntime([{ selector: '#pay', description: 'Pay now', method: 'click' }]);
        const approve = vi.fn(async () => true);
        const sp = new StagehandPerception(() => REAL_ENV, async () => inst, approve);
        const r = await sp.act('continue');
        expect(approve).toHaveBeenCalled();
        expect(r.success).toBe(true);
        expect(calls.map(c => c[0])).toEqual(['observe', 'act']);
    });
    it('approval provider that throws blocks the action (fail closed)', async () => {
        const { inst, calls } = fakeRuntime([{ selector: '#pay', description: 'Buy', method: 'click' }]);
        const sp = new StagehandPerception(() => REAL_ENV, async () => inst, async () => { throw new Error('x'); });
        expect((await sp.act('go')).securityGated).toBe(true);
        expect(calls.map(c => c[0])).toEqual(['observe']);
    });
    it('runtime failure is reported as failure, never as success', async () => {
        const { inst } = fakeRuntime([{ selector: '#a', description: 'Open settings', method: 'click' }], { data: { success: false, message: 'element detached', actions: [] } });
        const sp = new StagehandPerception(() => REAL_ENV, async () => inst);
        const r = await sp.act('open settings');
        expect(r.success).toBe(false);
        expect(r.error).toContain('element detached');
    });
});
