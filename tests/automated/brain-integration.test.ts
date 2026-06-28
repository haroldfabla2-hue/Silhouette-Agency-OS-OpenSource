/**
 * AUTOMATED TEST SUITE: Silhouette Brain Integration
 * Verifies the typed HTTP client + memory bridge against a mocked Brain API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrainClient } from '../../services/brain/brainClient';
import { BrainMemoryBridge } from '../../services/brain/brainMemoryBridge';

const BASE = 'http://brain.test:9876';

function makeClient(enabled = true) {
    return new BrainClient({ baseUrl: BASE, enabled, timeoutMs: 2000, healthTtlMs: 0 });
}

describe('Silhouette Brain Integration', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function jsonResponse(body: any, ok = true, status = 200) {
        return Promise.resolve({
            ok,
            status,
            text: () => Promise.resolve(JSON.stringify(body)),
        } as any);
    }

    describe('BrainClient', () => {
        it('is disabled by default when not configured', () => {
            const client = new BrainClient({ enabled: false });
            expect(client.isEnabled()).toBe(false);
        });

        it('returns null and does NOT call fetch when disabled', async () => {
            const client = makeClient(false);
            const result = await client.getReasoningContext('hello');
            expect(result).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('builds the correct reasoning-context URL with params', async () => {
            const client = makeClient();
            fetchMock.mockReturnValue(jsonResponse({ query: 'q', semantic: [], recent: [] }));
            await client.getReasoningContext('what is the plan', { semLimit: 7, synthesize: true });
            const calledUrl = fetchMock.mock.calls[0][0] as string;
            expect(calledUrl).toContain(`${BASE}/api/reasoning/context`);
            expect(calledUrl).toContain('query=what+is+the+plan');
            expect(calledUrl).toContain('sem_limit=7');
            expect(calledUrl).toContain('synthesize=true');
        });

        it('reports availability based on /api/status', async () => {
            const client = makeClient();
            fetchMock.mockReturnValue(jsonResponse({ status: 'ok', version: '2.0.0' }));
            expect(await client.isAvailable(true)).toBe(true);

            fetchMock.mockReturnValue(jsonResponse({ status: 'down' }, false, 503));
            expect(await client.isAvailable(true)).toBe(false);
        });

        it('fails closed (returns null) on network error', async () => {
            const client = makeClient();
            fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
            const result = await client.getReasoningContext('q');
            expect(result).toBeNull();
        });

        it('semanticSearch unwraps the results array', async () => {
            const client = makeClient();
            fetchMock.mockReturnValue(jsonResponse({ results: [{ content: 'a' }, { content: 'b' }] }));
            const hits = await client.semanticSearch('q', 5);
            expect(hits).toHaveLength(2);
            expect(hits[0].content).toBe('a');
        });

        it('addMemory POSTs a JSON body to /api/memory', async () => {
            const client = makeClient();
            fetchMock.mockReturnValue(jsonResponse({ status: 'ok', id: 42 }));
            const res = await client.addMemory('remember this', { tier: 'WORKING', tags: ['t'] });
            expect(res?.status).toBe('ok');
            const [, init] = fetchMock.mock.calls[0];
            expect(init.method).toBe('POST');
            const body = JSON.parse(init.body);
            expect(body.text).toBe('remember this');
            expect(body.tier).toBe('WORKING');
        });
    });

    describe('BrainMemoryBridge', () => {
        it('renders a reasoning context into a prompt block', () => {
            const bridge = new BrainMemoryBridge(makeClient());
            const block = bridge.renderContext({
                query: 'q',
                synthesis: 'The user prefers dark mode.',
                semantic: [{ content: 'fact A', score: 0.91 }],
                recent: [{ message: 'recent B' }],
            });
            expect(block.hasContent).toBe(true);
            expect(block.text).toContain('SILHOUETTE BRAIN');
            expect(block.text).toContain('The user prefers dark mode.');
            expect(block.text).toContain('fact A');
            expect(block.text).toContain('recent B');
        });

        it('returns an empty block when nothing is recalled', () => {
            const bridge = new BrainMemoryBridge(makeClient());
            const block = bridge.renderContext({ query: 'q', semantic: [], recent: [] });
            expect(block.hasContent).toBe(false);
            expect(block.text).toBe('');
        });

        it('getContextBlock short-circuits to empty when disabled', async () => {
            const bridge = new BrainMemoryBridge(makeClient(false));
            const block = await bridge.getContextBlock('q');
            expect(block.hasContent).toBe(false);
        });
    });
});
