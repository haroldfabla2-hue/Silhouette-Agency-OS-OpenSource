import { DEFAULT_API_CONFIG } from "../constants";

export interface SyncRequest {
    id: string;
    url: string;
    method: string;
    body: any;
    headers: any;
    timestamp: number;
    retryCount: number;
}

class SyncManager {
    private queue: SyncRequest[] = [];
    private isProcessing: boolean = false;
    private readonly STORAGE_KEY = 'silhouette_sync_queue';
    private readonly MAX_RETRIES = 5;
    private intervalId: NodeJS.Timeout | null = null;

    constructor() {
        this.loadQueue();
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => this.processQueue());
            // Periodic check with dynamic interval
            import('./powerManager').then(({ powerManager }) => {
                const intervalMs = powerManager.getConfig().syncManagerMs;
                this.intervalId = setInterval(() => this.processQueue(), intervalMs);
                console.log(`[SYNC] Queue processor started (${intervalMs}ms interval)`);
            }).catch(() => {
                // Fallback if powerManager not available
                this.intervalId = setInterval(() => this.processQueue(), 30000);
            });
        }
    }

    private loadQueue() {
        if (typeof window === 'undefined') return;
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                this.queue = JSON.parse(stored);
                console.log(`[SYNC] Loaded ${this.queue.length} pending requests.`);
            }
        } catch (e) {
            console.error("[SYNC] Failed to load queue", e);
        }
    }

    private saveQueue() {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
        } catch (e) {
            console.error("[SYNC] Failed to save queue", e);
        }
    }

    public async request(url: string, options: RequestInit = {}): Promise<Response> {
        try {
            // Try direct network request first
            const res = await fetch(url, options);
            if (!res.ok && res.status >= 500) {
                // Server error, might be temporary
                throw new Error(`Server Error: ${res.status}`);
            }
            return res;
        } catch (e) {
            // Network failure or Server Error -> Enqueue
            console.warn("[SYNC] Network request failed. Enqueuing for background sync.", e);

            // Only enqueue non-GET requests usually, but for this specific "Toggle" use case, 
            // we want to ensure state eventually matches.
            if (options.method !== 'GET') {
                this.enqueue({
                    id: crypto.randomUUID(),
                    url,
                    method: options.method || 'POST',
                    body: options.body ? JSON.parse(options.body as string) : {},
                    headers: options.headers,
                    timestamp: Date.now(),
                    retryCount: 0
                });
            }

            // Throw to let UI know we are offline (so it can show indicator), 
            // but we handled the data safety.
            throw e;
        }
    }

    private enqueue(req: Omit<SyncRequest, 'id' | 'timestamp' | 'retryCount'> & { id?: string, timestamp?: number, retryCount?: number }) {
        const request: SyncRequest = {
            id: req.id || crypto.randomUUID(),
            url: req.url,
            method: req.method,
            body: req.body,
            headers: req.headers,
            timestamp: req.timestamp || Date.now(),
            retryCount: req.retryCount || 0
        };
        this.queue.push(request);
        this.saveQueue();
    }

    public async processQueue() {
        if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) return;

        this.isProcessing = true;
        console.log(`[SYNC] Processing queue (${this.queue.length} items)...`);

        const remainingQueue: SyncRequest[] = [];

        for (const req of this.queue) {
            try {
                console.log(`[SYNC] Replaying: ${req.method} ${req.url}`);
                const res = await fetch(req.url, {
                    method: req.method,
                    headers: req.headers,
                    body: JSON.stringify(req.body)
                });

                if (res.ok) {
                    console.log(`[SYNC] Success: ${req.id}`);
                } else {
                    if (res.status >= 500) throw new Error("Server Error");
                    // If 4xx, it's a logic error, don't retry
                    console.error(`[SYNC] Logic Error ${res.status}. Dropping request.`);
                }
            } catch (e) {
                console.warn(`[SYNC] Retry failed for ${req.id}.`);
                req.retryCount++;
                if (req.retryCount < this.MAX_RETRIES) {
                    remainingQueue.push(req);
                } else {
                    console.error(`[SYNC] Max retries reached for ${req.id}. Dropping.`);
                }
            }
        }

        this.queue = remainingQueue;
        this.saveQueue();
        this.isProcessing = false;
    }

    public getQueueSize(): number {
        return this.queue.length;
    }
}

export const syncManager = new SyncManager();
