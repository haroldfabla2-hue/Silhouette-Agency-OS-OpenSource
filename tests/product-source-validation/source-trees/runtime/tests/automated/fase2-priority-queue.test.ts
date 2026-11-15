/**
 * FASE 2 (R2): Conversational priority + honest provider errors — REAL behavioral tests.
 *
 * Verifies the root fixes from the plan:
 * - Chat (conversational lane) dequeues before background work on the same keys.
 * - Background work is never starved: a streak limit serves it under sustained chat load.
 * - isAvailable() is a pure health check: it consumes ZERO tokens (no quota burned).
 * - Queued requests are cancellable via AbortSignal and never reach the network.
 * - Ollama errors are thrown, never yielded as assistant text (no error strings
 *   persisted as facts).
 * - The fact extractor defers a failed extraction instead of silently losing it.
 *
 * ZhipuService is exercised through its constructor injection (env + fetcher):
 * the fetcher is a controllable stand-in at the network boundary, never a mock
 * inside production code.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ZhipuService } from '../../services/zhipuService';
import { OllamaService } from '../../services/ollamaService';
import { FactExtractionService } from '../../services/factExtractor';

// ---------------------------------------------------------------------------
// Controllable fetcher: every HTTP call is captured and resolved by hand.
// ---------------------------------------------------------------------------
type CapturedCall = {
    url: string;
    init: any;
    resolve: (response: any) => void;
    reject: (error: any) => void;
};

function makeFetcher() {
    const calls: CapturedCall[] = [];
    const fetcher = ((url: any, init: any) => new Promise((resolve, reject) => {
        calls.push({ url: String(url), init, resolve, reject });
    })) as unknown as typeof fetch;
    const okResponse = (text: string) => ({
        ok: true,
        json: async () => ({
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
    });
    const complete = (index: number, text = 'respuesta') => calls[index].resolve(okResponse(text));
    return { calls, fetcher, complete };
}

const FAST = {
    MIN_REQUEST_INTERVAL: 0,
    QUEUE_RETRY_MS: 20,
    QUEUE_TIMEOUT_MS: 2000,
    TOKEN_REFILL_INTERVAL: 1,       // bucket refills almost instantly (cap still applies)
    QUEUE_SOFT_LIMIT: 100,
    QUEUE_HARD_LIMIT: 200
};

const oneKey = { ZHIPU_API_KEY: 'test-key-1' } as NodeJS.ProcessEnv;
const twoKeys = { ZHIPU_API_KEYS: 'test-key-1,test-key-2' } as NodeJS.ProcessEnv;

function settle(ms = 60): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Condition-based synchronization: poll until the dispatcher reaches the
 * expected state or fail loudly with a deadline. Fixed sleeps assume the
 * event loop fires within N ms - false on a loaded CI runner (observed:
 * main CI leg Node 22.18.0, run 38345940428, calls.length still 0 after
 * 60ms). Absence assertions (nothing new may dispatch) keep fixed waits:
 * completions are manual, so timing cannot produce a false positive there.
 */
async function waitFor(cond: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
        }
        await new Promise(r => setTimeout(r, 5));
    }
}

describe('R2: Zhipu conversational priority queue', () => {

    it('chat queued behind an in-flight background request is served next (1 key)', async () => {
        const { calls, fetcher, complete } = makeFetcher();
        const svc = new ZhipuService(FAST, oneKey, fetcher);

        // Background occupies the only key.
        const bg = svc.generateCompletion('extract facts', {}, 'background');
        await waitFor(() => calls.length === 1, 'background dispatch on idle system');
        expect(calls.length).toBe(1); // background dispatched immediately on idle system

        // Chat arrives while the key is busy: it must queue (no skipping Zhipu).
        const chat = svc.generateCompletion('user message', {}, 'agents');
        const bg2 = svc.generateCompletion('narrate', {}, 'background');
        await settle(80);
        expect(calls.length).toBe(1); // still only the background call in flight

        // Background finishes: CHAT is served before the queued background.
        complete(0, 'bg-done');
        await expect(bg).resolves.toBe('bg-done');
        await waitFor(() => calls.length === 2, 'chat dispatch after background completes');
        expect(calls.length).toBe(2);
        expect(JSON.stringify(calls[1].init.body)).toContain('user message');

        complete(1, 'chat-done');
        await expect(chat).resolves.toBe('chat-done');
        await waitFor(() => calls.length === 3, 'queued background dispatch after chat completes');
        expect(calls.length).toBe(3);

        complete(2, 'bg2-done');
        await expect(bg2).resolves.toBe('bg2-done');
    }, 15000);

    it('background lane is served under sustained chat load (anti-starvation streak)', async () => {
        const { calls, fetcher, complete } = makeFetcher();
        const svc = new ZhipuService({ ...FAST, CONVERSATIONAL_STREAK_LIMIT: 3 }, oneKey, fetcher);

        const occupying = svc.generateCompletion('chat-0', {}, 'agents');
        await waitFor(() => calls.length === 1, 'occupying chat dispatch');
        expect(calls.length).toBe(1);

        // Queue: 4 chats, then 1 background.
        const queued = [
            svc.generateCompletion('chat-1', {}, 'agents'),
            svc.generateCompletion('chat-2', {}, 'agents'),
            svc.generateCompletion('chat-3', {}, 'agents'),
            svc.generateCompletion('chat-4', {}, 'agents'),
            svc.generateCompletion('bg-task', {}, 'background')
        ];
        await settle(80);
        expect(calls.length).toBe(1);

        // Drain one at a time, recording dispatch order as each call appears.
        const dispatched: string[] = [];
        const all = Promise.all([occupying, ...queued]);
        let completedCount = 0;
        while (completedCount < 6) {
            await waitFor(() => calls.length > completedCount, `dispatch #${completedCount + 1} of 6`);
            const body = JSON.parse(calls[completedCount].init.body);
            dispatched.push(body.messages[1].content);
            complete(completedCount, `r${completedCount}`);
            completedCount++;
        }
        // chat-0 was in flight; the streak limit serves the waiting background
        // entry after 3 consecutive conversational dequeues, BEFORE chat-4.
        expect(dispatched).toEqual(['chat-0', 'chat-1', 'chat-2', 'chat-3', 'bg-task', 'chat-4']);
        await all;
    }, 15000);

    it('isAvailable() consumes zero tokens; one dispatch consumes exactly one', async () => {
        const { calls, fetcher, complete } = makeFetcher();
        const svc = new ZhipuService(FAST, oneKey, fetcher);
        const internal = svc as any;

        const tokensBefore = internal.keys[0].tokens;
        for (let i = 0; i < 10; i++) expect(svc.isAvailable()).toBe(true);
        expect(internal.keys[0].tokens).toBe(tokensBefore); // health check is free

        const req = svc.generateCompletion('hi', {}, 'agents');
        await waitFor(() => calls.length === 1, 'dispatch reserves a token');
        expect(internal.keys[0].tokens).toBe(tokensBefore - 1); // dispatch reserves one token
        complete(0);
        await expect(req).resolves.toBeDefined();
        expect(calls.length).toBe(1);
    }, 15000);

    it('aborting a queued request rejects it and it never reaches the network', async () => {
        const { calls, fetcher, complete } = makeFetcher();
        const svc = new ZhipuService(FAST, oneKey, fetcher);

        const occupying = svc.generateCompletion('long chat', {}, 'agents');
        await waitFor(() => calls.length === 1, 'occupying request dispatch');
        expect(calls.length).toBe(1);

        const controller = new AbortController();
        const queuedReq = svc.generateCompletion('stale work', { signal: controller.signal }, 'background');
        await settle();
        expect(calls.length).toBe(1);

        controller.abort();
        await expect(queuedReq).rejects.toThrow(/aborted/i);

        // Free the key: only the occupying request ever hit the network.
        complete(0);
        await expect(occupying).resolves.toBeDefined();
        await settle(80);
        expect(calls.length).toBe(1);
    }, 15000);

    it('with 2 keys, background and chat dispatch in parallel up to capacity', async () => {
        const { calls, fetcher, complete } = makeFetcher();
        const svc = new ZhipuService(FAST, twoKeys, fetcher);

        const bg = svc.generateCompletion('extract', {}, 'background');
        const chat = svc.generateCompletion('user message', {}, 'agents');
        await waitFor(() => calls.length === 2, 'parallel dispatch on both keys');
        expect(calls.length).toBe(2); // one per key: no artificial serialization

        complete(0); complete(1);
        await expect(bg).resolves.toBeDefined();
        await expect(chat).resolves.toBeDefined();
    }, 15000);
});

describe('R2: Ollama errors are thrown, never yielded as text', () => {
    it('generateChatStream against a dead server rejects and yields no error text', async () => {
        const ollama = new OllamaService(); // points at default localhost: nothing listening
        const chunks: string[] = [];
        let threw: Error | null = null;
        try {
            for await (const chunk of ollama.generateChatStream([{ role: 'user', content: 'hola' }])) {
                chunks.push(chunk);
            }
        } catch (e: any) {
            threw = e;
        }
        expect(threw).not.toBeNull();
        expect(chunks).toEqual([]); // zero content chunks
        expect(chunks.join('')).not.toContain('Local Brain');
        expect(chunks.join('')).not.toContain('Circuit Open');
    }, 20000);

    it('circuit-open failure throws instead of yielding a status string', async () => {
        const ollama = new OllamaService();
        (ollama as any).isCircuitOpen = true; // simulate tripped breaker
        (ollama as any).lastFailureTime = Date.now();
        let threw: Error | null = null;
        try {
            for await (const _ of ollama.generateStream('hola')) { /* must not yield */ }
        } catch (e: any) {
            threw = e;
        }
        expect(threw).not.toBeNull();
        expect(String(threw!.message)).toContain('Circuit Open');
    }, 10000);
});

describe('R2: fact extraction is deferred, never silently lost', () => {
    it('extractFromConversation throws on provider failure instead of returning []', async () => {
        const extractor = new FactExtractionService();
        // Force the internal extraction path to fail: no providers configured.
        await expect(
            extractor.extractFromConversation('me llamo Alberto', 'encantado, Alberto')
        ).rejects.toThrow();
    }, 20000);

    it('extractAndStore retries a failed turn instead of dropping it', async () => {
        vi.useFakeTimers();
        try {
            const extractor = new FactExtractionService();
            let attempts = 0;
            const internal = extractor as any;
            internal.extractFromConversation = async () => {
                attempts++;
                throw new Error('provider busy');
            };
            await extractor.extractAndStore('msg', 'resp', 'user-1');
            expect(attempts).toBe(1);
            // Deferred retry fires after DEFER_DELAY_MS.
            await vi.advanceTimersByTimeAsync(60000);
            expect(attempts).toBe(2);
            // No third attempt: the turn is dropped loudly after MAX_EXTRACT_ATTEMPTS.
            await vi.advanceTimersByTimeAsync(60000);
            expect(attempts).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    }, 15000);
});

describe('R2: source contracts hold', () => {
    const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

    it('ollamaService never yields error strings as stream content', () => {
        const src = read('services/ollamaService.ts');
        const yields = src.split('\n').filter(l => /^\s*yield\s/.test(l));
        for (const y of yields) {
            expect(y).not.toContain('Circuit Open');
            expect(y).not.toContain('Local Brain');
        }
    });

    it('chatController defers extraction through extractAndStore (background lane)', () => {
        const src = read('server/controllers/chatController.ts');
        expect(src).toContain('factExtractor.extractAndStore(');
        expect(src).not.toContain('extractFromConversation(userMessage, fullResponse)');
    });

    it('chat lane is conversational through the inference router', () => {
        const src = read('server/controllers/chatController.ts');
        expect(src).toContain("lane: 'conversational'");
        const router = read('services/llm/agentInferenceRouter.ts');
        expect(router).toContain('lane');
    });
});
