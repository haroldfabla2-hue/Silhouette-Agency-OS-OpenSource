
import { NeuroLinkNode, NeuroLinkStatus, SystemProtocol } from "../types";
import { systemBus } from "./systemBus";

// --- NEURO-LINK SERVICE V1.0 ---
// The connection layer of the Hive Mind.
// Manages real-time WebSocket tunnels to deployed child applications.

export class NeuroLinkService {
    private discoveryInterval: any;
    private discoveryStopped = false;
    private nodes: Map<string, NeuroLinkNode> = new Map();

    constructor() {
        this.startDiscovery();
    }

    public registerNode(projectId: string, url: string, category: any = 'DEV') {
        if (this.discoveryStopped) return; // no new work after stopDiscovery
        if (this.nodes.has(projectId)) return;

        const node: NeuroLinkNode = {
            id: `neuro-${crypto.randomUUID().substring(0, 8)}`,
            projectId,
            url,
            status: NeuroLinkStatus.HANDSHAKE,
            latency: 0,
            lastHeartbeat: Date.now(),
            resources: { cpu: 0, memory: 0 },
            category
        };

        this.nodes.set(projectId, node);
        this.checkNodeHealth(node); // Immediate check
    }

    public getNodes(): NeuroLinkNode[] {
        return Array.from(this.nodes.values());
    }

    public sendRPC(projectId: string, method: string, payload: any) {
        const node = this.nodes.get(projectId);
        if (!node || node.status !== NeuroLinkStatus.CONNECTED) {
            console.warn(`[NEURO-LINK] Cannot send RPC to ${projectId}: Node not connected.`);
            return;
        }

        // Real RPC implementation would go here (e.g. POST /rpc)
        console.log(`[NEURO-LINK] RPC >>> ${node.url} [${method}]`, payload);
    }

    // Returns the SDK code to be injected into child apps
    public getSDKCode(projectId: string): string {
        return `
// --- SILHOUETTE NEURO-LINK SDK v2.0 ---
// Injected by Genesis Factory. Bypasses local styles via Shadow DOM.

(function() {
    console.log("[NEURO-LINK] Initializing Ghost Shell...");
    const PROJECT_ID = "${projectId}";
    
    // ... (Rest of SDK code remains similar for now, but would point to real WS) ...
})();
        `;
    }

    private startDiscovery() {
        // Real Service Discovery Loop
        this.discoveryInterval = setInterval(() => {
            this.nodes.forEach(node => {
                this.checkNodeHealth(node);
            });
        }, 5000); // Check every 5 seconds
    }

    // TIMER-ONLY scope, not a producer drain: stops the discovery interval
    // and refuses new node registrations. It does NOT drain in-flight health
    // checks; each check clears its own 2s abort timeout in `finally` (they
    // are transient). The hydration-gates capsule uses this with a provably
    // empty node set (receipt asserts nodesRegistered === 0); on a populated
    // instance this is not a shutdown of owned work.
    public stopDiscovery(): { intervalWasArmed: boolean; nodesRegistered: number } {
        this.discoveryStopped = true;
        const intervalWasArmed = this.discoveryInterval !== undefined && this.discoveryInterval !== null;
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }
        return { intervalWasArmed, nodesRegistered: this.nodes.size };
    }

    private async checkNodeHealth(node: NeuroLinkNode) {
        const start = Date.now();
        try {
            // Real HTTP Ping
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            let res;
            try {
                res = await fetch(node.url, {
                    method: 'HEAD',
                    signal: controller.signal
                });
            } finally {
                // The abort timeout is cleared on EVERY path (resolution,
                // abort, network error): a rejected fetch must not leave a
                // live timer behind.
                clearTimeout(timeoutId);
            }

            if (res.ok || res.status === 404) { // 404 means server is up but maybe no root route
                node.status = NeuroLinkStatus.CONNECTED;
                node.latency = Date.now() - start;
                node.lastHeartbeat = Date.now();

                // Try to get real metrics if exposed
                // this.fetchMetrics(node); 
            } else {
                node.status = NeuroLinkStatus.DISCONNECTED;
            }
        } catch (e) {
            node.status = NeuroLinkStatus.DISCONNECTED;
            node.latency = -1;
        }
    }
}

export const neuroLink = new NeuroLinkService();
