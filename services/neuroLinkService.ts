
import { NeuroLinkNode, NeuroLinkStatus, SystemProtocol } from "../types";
import { systemBus } from "./systemBus";

// --- NEURO-LINK SERVICE V1.0 ---
// The connection layer of the Hive Mind.
// Manages real-time WebSocket tunnels to deployed child applications.

export class NeuroLinkService {
    private discoveryInterval: any;
    private nodes: Map<string, NeuroLinkNode> = new Map();

    constructor() {}
    private closing = false;
    private readonly probes = new Set<Promise<void>>();
    private readonly controllers = new Set<AbortController>();
    private readonly diagnostics: unknown[] = [];
    public getLifecycleDiagnostics(): readonly unknown[] { return [...this.diagnostics]; }
    public start(): void {
        if (this.closing) throw new Error('NeuroLink closed');
        if (!this.discoveryInterval) this.startDiscovery();
    }
    private probe(node: NeuroLinkNode): void {
        if (this.closing) return;
        const task = this.checkNodeHealth(node);
        this.probes.add(task);
        void task.then(() => this.probes.delete(task), error => { this.probes.delete(task); this.diagnostics.push(error); });
    }
    public async shutdown(): Promise<void> {
        this.closing = true;
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);
        this.discoveryInterval = undefined;
        for (const controller of this.controllers) controller.abort();
        await Promise.allSettled([...this.probes]);
    }

    public registerNode(projectId: string, url: string, category: any = 'DEV') {
        if (this.closing) throw new Error('NeuroLink closed');
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
        this.probe(node); // Immediate check
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
                this.probe(node);
            });
        }, 5000); // Check every 5 seconds
    }

    private async checkNodeHealth(node: NeuroLinkNode) {
        const start = Date.now();
        const controller = new AbortController();
        this.controllers.add(controller);
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        try {
            // Real HTTP Ping

            const res = await fetch(node.url, {
                method: 'HEAD',
                signal: controller.signal
            });

            if (this.closing) return;

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
            this.diagnostics.push({ error: e, disposition: 'DEGRADED_FALLBACK', originalCapability: 'UNAVAILABLE' });
            if (this.closing) return;
            node.status = NeuroLinkStatus.DISCONNECTED;
            node.latency = -1;
        } finally { clearTimeout(timeoutId); this.controllers.delete(controller); }
    }
}

export const neuroLink = new NeuroLinkService();
