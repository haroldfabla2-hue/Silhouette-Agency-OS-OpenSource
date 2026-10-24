import { describe, it, expect } from 'vitest';
import { AdmissionQueue, AdmissionTimeout } from '../../../services/llm/admissionQueue';

function deferred<T = void>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe('AdmissionQueue', () => {
    it('never lets background work queue ahead of conversational', async () => {
        const q = new AdmissionQueue(1);
        const gate = deferred();
        const order: string[] = [];
        const running = q.run('GEMINI', 'background', async () => { await gate.promise; });
        const bg = q.run('GEMINI', 'background', async () => { order.push('bg'); });
        const conv = q.run('GEMINI', 'conversational', async () => { order.push('conv'); });
        gate.resolve();
        await Promise.all([running, bg, conv]);
        expect(order).toEqual(['conv', 'bg']);
    });
    it('holds admissions during a provider Retry-After gate', async () => {
        let now = 1_000;
        const q = new AdmissionQueue(1, 5_000, () => now);
        q.gateUntil('GROQ', now + 2_000);
        const started: number[] = [];
        const p = q.run('GROQ', 'conversational', async () => { started.push(now); });
        await new Promise(r => setTimeout(r, 20));
        expect(started).toHaveLength(0); // still gated
        now += 2_000;
        // pump happens on next enqueue/release; trigger via a no-op admission
        await q.run('GROQ', 'background', async () => {});
        await p;
        expect(started[0]).toBe(3_000);
    });
    it('rejects waits beyond maxWaitMs so the router can fail over', async () => {
        const q = new AdmissionQueue(1, 100);
        const gate = deferred();
        const running = q.run('NVIDIA', 'background', () => gate.promise);
        await expect(q.run('NVIDIA', 'conversational', async () => {})).rejects.toBeInstanceOf(AdmissionTimeout);
        gate.resolve();
        await running;
    });
    it('aborted waiters leave the queue', async () => {
        const q = new AdmissionQueue(1, 5_000);
        const gate = deferred();
        const running = q.run('X', 'background', () => gate.promise);
        const ac = new AbortController();
        const p = q.run('X', 'conversational', async () => {}, ac.signal);
        ac.abort();
        await expect(p).rejects.toThrow('aborted');
        expect(q.queued('X')).toBe(0);
        gate.resolve();
        await running;
    });
});
