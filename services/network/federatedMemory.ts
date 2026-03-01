import crypto from 'crypto';
import { MemoryNode } from '../types';
import { systemBus } from './systemBus';

export interface PeerNode {
    id: string;
    endpointUrl: string;
    publicKey: string;
    trustScore: number;
    lastSeen: number;
}

export interface SyncPayload {
    sourceId: string;
    signature: string;
    nodes: MemoryNode[];
}

/**
 * FEDERATED MEMORY SERVICE (P2P Mesh)
 * Enables distinct Silhouette OS instances to connect, share safe semantic knowledge vectors,
 * and build a decentralized Swarm intelligence without compromising local episodic privacy.
 */
class FederatedMemoryService {
    private localId: string;
    private keyPair: crypto.KeyPairSyncResult<string, string>;
    private peers: Map<string, PeerNode> = new Map();

    constructor() {
        this.localId = crypto.randomUUID();
        // Generate ephemeral/persistent RSA keys for P2P authentication
        this.keyPair = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        console.log(`[FEDERATED MEMORY] 🌐 Initializing P2P Mesh Node: ${this.localId}`);
    }

    // --- P2P Mesh Setup ---
    public addPeer(endpointUrl: string, publicKey: string) {
        // Peer ID is a hash of their public key for uniqueness
        const peerId = crypto.createHash('sha256').update(publicKey).digest('hex').substring(0, 16);
        this.peers.set(peerId, {
            id: peerId,
            endpointUrl,
            publicKey,
            trustScore: 0.5, // Start with neutral trust
            lastSeen: Date.now()
        });
        console.log(`[FEDERATED MEMORY] 🤝 Connected to Peer: ${peerId}`);
    }

    public getLocalId(): string {
        return this.localId;
    }

    public getPublicKey(): string {
        return this.keyPair.publicKey;
    }

    // --- Cryptographic Handshake & Validation ---
    private signPayload(data: any): string {
        const sign = crypto.createSign('SHA256');
        sign.update(JSON.stringify(data));
        sign.end();
        return sign.sign(this.keyPair.privateKey, 'hex');
    }

    private verifySignature(data: any, signature: string, publicKey: string): boolean {
        const verify = crypto.createVerify('SHA256');
        verify.update(JSON.stringify(data));
        verify.end();
        return verify.verify(publicKey, signature, 'hex');
    }

    // --- Knowledge Exchange ---

    /**
     * Broadcasts a major semantic discovery to trusted peers.
     */
    public async broadcastKnowledge(nodes: MemoryNode[]): Promise<void> {
        if (this.peers.size === 0) return;

        // Only share SAFE semantic knowledge (no personal working/episodic memory)
        const safeNodes = nodes.filter(n => n.tags && n.tags.includes('SAFE_SHARE'));
        if (safeNodes.length === 0) return;

        const payload: SyncPayload = {
            sourceId: this.localId,
            signature: this.signPayload(safeNodes),
            nodes: safeNodes
        };

        for (const [peerId, peer] of this.peers) {
            try {
                // In production, this uses an actual fetch HTTP POST or WebSocket emit
                // await fetch(`${peer.endpointUrl}/v1/p2p/sync`, { method: 'POST', body: JSON.stringify(payload) });
                console.log(`[FEDERATED MEMORY] 📡 Broadcasted ${safeNodes.length} concepts to ${peerId}`);
            } catch (e) {
                console.warn(`[FEDERATED MEMORY] ⚠️ Failed to reach peer ${peerId}`);
            }
        }
    }

    /**
     * Receives and validates knowledge from a peer instance over HTTP hook.
     */
    public async receiveKnowledge(payload: SyncPayload): Promise<boolean> {
        // 1. Find peer by sourceId
        // In local development or zero-trust, we might verify endpoints dynamically
        const peer = Array.from(this.peers.values()).find(p => p.id === payload.sourceId);

        if (!peer) {
            console.warn(`[FEDERATED MEMORY] 🛑 Unknown peer (${payload.sourceId}) attempted structural sync.`);
            return false;
        }

        // 2. Cryptographic verification
        if (!this.verifySignature(payload.nodes, payload.signature, peer.publicKey)) {
            console.error(`[FEDERATED MEMORY] 🛑 Cryptographic verification failed for ${peer.id}! Discarding payload.`);
            peer.trustScore -= 0.1; // Penalize failed signature
            return false;
        }

        console.log(`[FEDERATED MEMORY] 📥 Received ${payload.nodes.length} verified concepts from ${peer.id}.`);
        peer.trustScore += 0.05; // Reward valid share
        peer.lastSeen = Date.now();

        // 3. Integrate into Continuum Memory (as MEDIUM/DEEP semantic knowledge)
        import('./continuumMemory').then(({ continuum }) => {
            payload.nodes.forEach(node => {
                continuum.store(
                    node.content,
                    undefined, // tier defaults inside continuum based on logic, or forced DEEP
                    ['FEDERATED', `SOURCE_${peer.id}`, ...(node.tags || [])]
                ).catch(() => { });
            });
        });

        return true;
    }
}

export const federatedMemory = new FederatedMemoryService();
