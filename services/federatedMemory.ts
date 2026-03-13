import { systemBus } from './systemBus';
import { SystemProtocol, MemoryTier } from '../types';
import { continuum } from './continuumMemory';
import crypto from 'crypto';

export interface SyncPeer {
    id: string;
    endpointUrl: string;
    trustLevel: number; // 0.0 to 1.0 (How much memory sharing is allowed)
    lastSeen: number;
    authorized: boolean;
}

export interface SyncPayload {
    originId: string;
    timestamp: number;
    memories: any[]; // Simulated memory exchange
    merkleRoot: string;
}

/**
 * P2P Knowledge Sharing Protocol
 * Allows multiple distinct Silhouette OS instances to federate their semantic memories.
 * e.g., A research agent on Machine A shares "Graph theory" vectors with an agent on Machine B.
 */
export class FederatedMemoryService {
    private instanceId: string = crypto.randomUUID();
    private peers: Map<string, SyncPeer> = new Map();
    private isSyncing: boolean = false;

    public async initialize(): Promise<void> {
        console.log(`[FEDERATED_MEMORY] Initializing P2P Sync Protocol. Instance ID: ${this.instanceId}`);
        // In a real network, this would scan mDNS or use WebRTC for peer discovery.

        systemBus.subscribe(SystemProtocol.HIVE_MIND_SYNC, this.handleIncomingSync.bind(this));
    }

    public getPeers(): SyncPeer[] {
        return Array.from(this.peers.values());
    }

    public authorizePeer(peerUrl: string, trustLevel: number = 0.5): void {
        const peerId = crypto.randomUUID();
        this.peers.set(peerId, {
            id: peerId,
            endpointUrl: peerUrl,
            trustLevel,
            lastSeen: Date.now(),
            authorized: true
        });
        console.log(`[FEDERATED_MEMORY] Peer Authorized: ${peerUrl} (Trust: ${trustLevel})`);
    }

    public async initiateSwarmSync(): Promise<void> {
        if (this.isSyncing || this.peers.size === 0) return;
        this.isSyncing = true;

        try {
            console.log(`[FEDERATED_MEMORY] Initiating outbound swarm sync to ${this.peers.size} nodes...`);

            // Extract public knowledge
            const publicMemories = await continuum.retrieve('public generalized knowledge', undefined, 'SYSTEM');

            const payload: SyncPayload = {
                originId: this.instanceId,
                timestamp: Date.now(),
                memories: publicMemories.filter(m => m.tier === MemoryTier.DEEP), // Only share semantic knowledge
                merkleRoot: 'mocked-merkle-hash-for-integrity'
            };

            // Simulate HTTP dispatch to peers
            for (const peer of this.peers.values()) {
                if (!peer.authorized) continue;
                // mock network delay
                await new Promise(r => setTimeout(r, 200));
                console.log(`[FEDERATED_MEMORY] Dispatched ${payload.memories.length} vectors to ${peer.endpointUrl}`);
            }

        } catch (e) {
            console.error('[FEDERATED_MEMORY] Swarm sync failed', e);
        } finally {
            this.isSyncing = false;
        }
    }

    private async handleIncomingSync(event: any): Promise<void> {
        const payload = event.data as SyncPayload;
        console.log(`[FEDERATED_MEMORY] Incoming sync from peer ${payload.originId}. Vectors: ${payload.memories?.length || 0}`);

        // Simulating memory assimilation
        if (payload.memories && payload.memories.length > 0) {
            for (const mem of payload.memories.slice(0, 5)) { // limit assimilation chunk
                await continuum.store(`[FEDERATED_INJECT] ${mem.content}`, undefined, ['federated', 'external']);
            }
            console.log(`[FEDERATED_MEMORY] Assimilated external memory chunks.`);
        }
    }
}

export const federatedMemory = new FederatedMemoryService();
