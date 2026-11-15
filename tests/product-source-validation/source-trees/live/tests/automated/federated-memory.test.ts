/**
 * AUTOMATED TEST SUITE: Federated Memory (P2P sync over HTTP)
 * Verifies real Merkle integrity, dedup, self-origin handling, and HTTP dispatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Avoid touching real memory storage during assimilation.
const { storeMock, retrieveMock } = vi.hoisted(() => ({
    storeMock: vi.fn().mockResolvedValue(undefined),
    retrieveMock: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/continuumMemory', () => ({
    continuum: { store: storeMock, retrieve: retrieveMock },
}));
vi.mock('../../services/systemBus', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/systemBus')>();
    return { ...actual, systemBus: { emit: vi.fn(), subscribe: vi.fn(), on: vi.fn() } };
});

import { FederatedMemoryService, SyncPayload } from '../../services/federatedMemory';

describe('Federated Memory', () => {
    let svc: FederatedMemoryService;

    beforeEach(() => {
        svc = new FederatedMemoryService();
        storeMock.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('computeMerkleRoot', () => {
        it('is deterministic and order-independent', () => {
            const a = svc.computeMerkleRoot([{ content: 'x' }, { content: 'y' }, { content: 'z' }]);
            const b = svc.computeMerkleRoot([{ content: 'z' }, { content: 'x' }, { content: 'y' }]);
            expect(a).toBe(b);
            expect(a).toMatch(/^[a-f0-9]{64}$/);
        });

        it('changes when content changes', () => {
            const a = svc.computeMerkleRoot([{ content: 'x' }]);
            const b = svc.computeMerkleRoot([{ content: 'X' }]);
            expect(a).not.toBe(b);
        });
    });

    describe('receiveSync', () => {
        function signedPayload(memories: { content: string }[], originId = 'peer-1'): SyncPayload {
            return { originId, timestamp: Date.now(), memories, merkleRoot: svc.computeMerkleRoot(memories) };
        }

        it('assimilates a valid, integrity-checked payload', async () => {
            const res = await svc.receiveSync(signedPayload([{ content: 'graph theory basics' }]));
            expect(res.ok).toBe(true);
            expect(res.assimilated).toBe(1);
            expect(storeMock).toHaveBeenCalledTimes(1);
        });

        it('rejects payloads with a tampered Merkle root (no assimilation)', async () => {
            const payload = signedPayload([{ content: 'legit' }]);
            payload.merkleRoot = 'deadbeef';
            const res = await svc.receiveSync(payload);
            expect(res.ok).toBe(false);
            expect(res.reason).toContain('merkle');
            expect(storeMock).not.toHaveBeenCalled();
        });

        it('ignores self-origin payloads', async () => {
            const payload = signedPayload([{ content: 'mine' }], svc.getInstanceId());
            const res = await svc.receiveSync(payload);
            expect(res.assimilated).toBe(0);
            expect(storeMock).not.toHaveBeenCalled();
        });

        it('dedups identical payloads (idempotent)', async () => {
            const payload = signedPayload([{ content: 'repeat me' }]);
            await svc.receiveSync(payload);
            const second = await svc.receiveSync(payload);
            expect(second.assimilated).toBe(0);
            expect(storeMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('dispatchToPeer', () => {
        it('POSTs the payload to the peer sync endpoint and returns the ack', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ ok: true, assimilated: 2, rejected: 0 }),
            } as any);
            vi.stubGlobal('fetch', fetchMock);

            const peer = svc.authorizePeer('https://peer.example.com', 1);
            const payload = { originId: 'me', timestamp: Date.now(), memories: [{ content: 'a' }], merkleRoot: svc.computeMerkleRoot([{ content: 'a' }]) };
            const res = await svc.dispatchToPeer(peer, payload);

            expect(res?.assimilated).toBe(2);
            const calledUrl = fetchMock.mock.calls[0][0] as string;
            expect(calledUrl).toBe('https://peer.example.com/v1/federated/sync');
            expect(fetchMock.mock.calls[0][1].method).toBe('POST');
        });

        it('fails gracefully (null) when the peer is unreachable', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
            const peer = svc.authorizePeer('https://down.example.com', 1);
            const res = await svc.dispatchToPeer(peer, { originId: 'me', timestamp: Date.now(), memories: [], merkleRoot: svc.computeMerkleRoot([]) });
            expect(res).toBeNull();
        });
    });
});
