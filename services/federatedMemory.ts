import { subscribeScoped } from './runtime/scopedSubscription';
import { ResourceScope } from '../server/runtime/resourceScope';
import { systemBus } from './systemBus';
import { SystemProtocol, MemoryTier } from '../types';
import { continuum } from './continuumMemory';
import { logger } from './logger';
import crypto from 'crypto';

const log = logger.child({ service: 'FederatedMemory' });

export interface SyncPeer {
    id: string;
    endpointUrl: string;   // base URL of the peer OS, e.g. https://peer.example.com
    trustLevel: number;    // 0.0 to 1.0 (how much memory sharing is allowed)
    lastSeen: number;
    authorized: boolean;
}

export interface FederatedMemoryItem {
    content: string;
    tags?: string[];
    importance?: number;
}

export interface SyncPayload {
    originId: string;
    timestamp: number;
    memories: FederatedMemoryItem[];
    merkleRoot: string; // integrity hash over the memory contents
}

export interface SyncResult {
    ok: boolean;
    assimilated: number;
    rejected: number;
    reason?: string;
}

const SYNC_PATH = '/v1/federated/sync';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ASSIMILATE = 50;

/**
 * P2P Knowledge Sharing Protocol (over HTTP).
 *
 * Lets distinct Silhouette OS instances federate their semantic (DEEP) memories.
 * Each instance exposes POST /v1/federated/sync; peers push generalized knowledge
 * to one another. Integrity is protected with a real Merkle-style content root,
 * and assimilation is deduplicated so the same fact isn't stored twice.
 *
 * This is best-effort and auth-gated: peers must be authorized, payloads must be
 * verifiable, and an optional shared token (FEDERATED_SYNC_TOKEN) is required.
 */
export class FederatedMemoryService {
    private readonly operations = new ResourceScope('FederatedMemoryService');
    public getLifecycleStatus() { return { diagnostics: this.operations.getDiagnostics(), failures: this.operations.getFailures() }; }
    public shutdownLifecycle() { return this.operations.close(); }
    private instanceId: string = crypto.randomUUID();
    private peers: Map<string, SyncPeer> = new Map();
    private isSyncing: boolean = false;
    private assimilatedRoots: Set<string> = new Set(); // dedup of already-seen payloads
    private stats = { outboundSyncs: 0, inboundSyncs: 0, assimilated: 0, rejected: 0, failures: 0 };

    private initialized = false;
    public async initialize(): Promise<void> {
        return this.operations.run('initialize', async () => {

        if (this.initialized) return;
        this.operations.assertAccepting();
        this.initialized = true;
        log.info({ instanceId: this.instanceId }, 'Initializing P2P sync protocol');
        // In-process bus path (for co-located instances / tests).
        subscribeScoped(this.operations, systemBus, SystemProtocol.HIVE_MIND_SYNC, this.handleBusSync.bind(this));
    
        });
    }

    public getInstanceId(): string {
        this.operations.assertWorkAccepted();

        return this.instanceId;
    }

    public getStats() {
        this.operations.assertWorkAccepted();

        return { ...this.stats };
    }

    public getPeers(): SyncPeer[] {
        this.operations.assertWorkAccepted();

        return Array.from(this.peers.values());
    }

    public authorizePeer(peerUrl: string, trustLevel: number = 0.5): SyncPeer {
        this.operations.assertWorkAccepted();

        const peerId = crypto.randomUUID();
        const peer: SyncPeer = {
            id: peerId,
            endpointUrl: peerUrl.replace(/\/+$/, ''),
            trustLevel: Math.max(0, Math.min(1, trustLevel)),
            lastSeen: Date.now(),
            authorized: true,
        };
        this.peers.set(peerId, peer);
        log.info({ peerUrl, trustLevel }, 'Peer authorized');
        return peer;
    }

    public revokePeer(peerId: string): boolean {
        this.operations.assertWorkAccepted();

        return this.peers.delete(peerId);
    }

    // ─── Integrity ───────────────────────────────────────────────────────────

    /**
     * Compute a Merkle-style integrity root over the memory contents. Order-
     * independent (leaves are sorted) so two peers with the same set agree.
     */
    public computeMerkleRoot(memories: FederatedMemoryItem[]): string {
        this.operations.assertWorkAccepted();

        if (!memories.length) return crypto.createHash('sha256').update('').digest('hex');
        const leaves = memories
            .map(m => crypto.createHash('sha256').update(m.content || '').digest('hex'))
            .sort();
        let level = leaves;
        while (level.length > 1) {
            const next: string[] = [];
            for (let i = 0; i < level.length; i += 2) {
                const a = level[i];
                const b = level[i + 1] ?? level[i]; // duplicate last if odd
                next.push(crypto.createHash('sha256').update(a + b).digest('hex'));
            }
            level = next;
        }
        return level[0];
    }

    private buildPayload(memories: FederatedMemoryItem[]): SyncPayload {
        return {
            originId: this.instanceId,
            timestamp: Date.now(),
            memories,
            merkleRoot: this.computeMerkleRoot(memories),
        };
    }

    // ─── Outbound ────────────────────────────────────────────────────────────

    public async initiateSwarmSync(): Promise<void> {
        return this.operations.run('initiateSwarmSync', async () => {

        if (this.isSyncing || this.peers.size === 0) return;
        this.isSyncing = true;

        try {
            const deep = await continuum.retrieve('public generalized knowledge', undefined, 'SYSTEM');
            const memories: FederatedMemoryItem[] = deep
                .filter(m => m.tier === MemoryTier.DEEP)
                .map(m => ({ content: m.content, tags: m.tags, importance: m.importance }));

            if (!memories.length) {
                log.info({}, 'No shareable DEEP memories — skipping outbound sync');
                return;
            }

            const payload = this.buildPayload(memories);
            log.info({ peers: this.peers.size, vectors: memories.length, merkleRoot: payload.merkleRoot.slice(0, 12) }, 'Outbound swarm sync');

            for (const peer of this.peers.values()) {
                if (!peer.authorized) continue;
                // Respect per-peer trust: only share a proportional slice.
                const slice = payload.memories.slice(0, Math.max(1, Math.floor(payload.memories.length * peer.trustLevel)));
                const peerPayload = { ...payload, memories: slice, merkleRoot: this.computeMerkleRoot(slice) };
                await this.dispatchToPeer(peer, peerPayload);
            }
            this.stats.outboundSyncs++;
        } catch (e: any) {
            this.stats.failures++;
            log.error({ error: e?.message }, 'Swarm sync failed');
        } finally {
            this.isSyncing = false;
        }
    
        });
    }

    /** Real HTTP dispatch to a single peer (POST {endpoint}/v1/federated/sync). */
    public async dispatchToPeer(peer: SyncPeer, payload: SyncPayload): Promise<SyncResult | null> {
        return this.operations.run('dispatchToPeer', async () => {

        const url = `${peer.endpointUrl}${SYNC_PATH}`;
        this.operations.assertAccepting();
        const controller = new AbortController();
        const release = this.operations.own({ name: 'federated-http', stopIntake: () => controller.abort(), close: () => controller.abort() });
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            const token = process.env.FEDERATED_SYNC_TOKEN;
            if (token) headers['X-Federated-Token'] = token;

            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = res.body;
                const releaseBody = this.operations.own({ name: 'federated-response-body', close: async () => { await body?.cancel(); } });
                await releaseBody();
                this.operations.recordDiagnostic('federated-http-status', new Error(`HTTP ${res.status}`), 'DEGRADED_FALLBACK', 'UNAVAILABLE');
                this.stats.failures++;
                log.warn({ url, status: res.status }, 'Peer rejected sync');
                return null;
            }
            peer.lastSeen = Date.now();
            const result = await res.json().catch(error => {
                this.operations.recordDiagnostic('federated-response-body', error, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
                return null;
            }) as SyncResult | null;
            log.info({ url, assimilated: result?.assimilated }, 'Peer acknowledged sync');
            return result;
        } catch (e: any) {
            this.stats.failures++;
            this.operations.recordDiagnostic('federated-peer-request', e, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
            log.warn({ url, error: e?.message }, 'Failed to reach peer');
            return null;
        } finally {
            clearTimeout(timer);
            await release();
        }
    
        });
    }

    // ─── Inbound ─────────────────────────────────────────────────────────────

    /**
     * Receive a sync payload (from the HTTP endpoint or the bus). Verifies the
     * Merkle root, dedups against previously-seen payloads, and assimilates the
     * memories. Returns an ack with counts.
     */
    public async receiveSync(payload: SyncPayload): Promise<SyncResult> {
        return this.operations.run('receiveSync', async () => {

        this.stats.inboundSyncs++;

        if (!payload || !Array.isArray(payload.memories)) {
            this.stats.rejected++;
            return { ok: false, assimilated: 0, rejected: 0, reason: 'malformed payload' };
        }
        if (payload.originId === this.instanceId) {
            return { ok: true, assimilated: 0, rejected: 0, reason: 'self-origin ignored' };
        }

        // Integrity check: recomputed root must match the claimed root.
        const recomputed = this.computeMerkleRoot(payload.memories);
        if (recomputed !== payload.merkleRoot) {
            this.stats.rejected++;
            log.warn({ origin: payload.originId }, 'Merkle root mismatch — rejecting payload');
            return { ok: false, assimilated: 0, rejected: payload.memories.length, reason: 'merkle mismatch' };
        }

        // Dedup whole-payload by root.
        if (this.assimilatedRoots.has(recomputed)) {
            return { ok: true, assimilated: 0, rejected: 0, reason: 'duplicate payload' };
        }
        this.assimilatedRoots.add(recomputed);
        if (this.assimilatedRoots.size > 1000) {
            this.assimilatedRoots = new Set(Array.from(this.assimilatedRoots).slice(-500));
        }

        let assimilated = 0;
        for (const mem of payload.memories.slice(0, MAX_ASSIMILATE)) {
            const content = (mem?.content || '').trim();
            if (!content) continue;
            await continuum.store(
                `[FEDERATED] ${content}`,
                MemoryTier.DEEP,
                ['federated', 'external', `origin:${payload.originId}`],
            );
            assimilated++;
        }
        this.stats.assimilated += assimilated;
        log.info({ origin: payload.originId, assimilated }, 'Assimilated federated memories');
        return { ok: true, assimilated, rejected: payload.memories.length - assimilated };
    
        });
    }

    private async handleBusSync(event: any): Promise<void> {
        return this.operations.run('handleBusSync', async () => {

        const payload = event?.data as SyncPayload;
        if (payload) await this.receiveSync(payload);
    
        });
    }
}

export const federatedMemory = new FederatedMemoryService();
