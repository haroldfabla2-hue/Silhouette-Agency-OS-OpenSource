/**
 * [auth-connections] Provider admission with priority lanes and Retry-After
 * gates (pattern verified in OpenClaw src/llm/provider-rate-limit.ts, MIT,
 * commit d25ac78): conversational traffic never queues behind background
 * work; a provider-side 429 gates admissions until its retryAt instead of
 * burning more calls; waits beyond maxWaitMs reject so the router can fail
 * over. In-process; cross-process cooldown stays in the durable cooldown
 * recorder (geminiService, deployed #198-200).
 */
export type Lane = 'conversational' | 'background';

interface Waiter {
    lane: Lane;
    enqueuedAt: number;
    resolve: (ticket: () => void) => void;
    reject: (err: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
}

interface ProviderGate {
    /** No admission before this time (provider Retry-After evidence). */
    retryAt: number;
    running: number;
    queue: Waiter[];
}

export class AdmissionTimeout extends Error {
    constructor(public readonly providerId: string) { super(`Admission wait exceeded for ${providerId}`); }
}

export class AdmissionQueue {
    private gates = new Map<string, ProviderGate>();
    constructor(
        private readonly maxConcurrentPerProvider = 1,
        private readonly maxWaitMs = 60_000,
        private readonly now: () => number = Date.now,
    ) {}

    private gate(providerId: string): ProviderGate {
        let g = this.gates.get(providerId);
        if (!g) { g = { retryAt: 0, running: 0, queue: [] }; this.gates.set(providerId, g); }
        return g;
    }

    /** Record provider Retry-After evidence; admissions hold until then. */
    gateUntil(providerId: string, retryAt: number): void {
        const g = this.gate(providerId);
        g.retryAt = Math.max(g.retryAt, retryAt);
    }

    private pump(providerId: string): void {
        const g = this.gate(providerId);
        if (g.running >= this.maxConcurrentPerProvider || this.now() < g.retryAt) return;
        // conversational first, FIFO within a lane
        g.queue.sort((a, b) => (a.lane === b.lane ? a.enqueuedAt - b.enqueuedAt : a.lane === 'conversational' ? -1 : 1));
        const next = g.queue.shift();
        if (!next) return;
        g.running++;
        let done = false;
        next.resolve(() => {
            if (done) return;
            done = true;
            g.running--;
            this.pump(providerId);
        });
        this.pump(providerId);
    }

    /**
     * Wait for admission, run fn, release. Rejects with AdmissionTimeout past
     * maxWaitMs (router should fail over), and immediately on abort.
     */
    async run<T>(providerId: string, lane: Lane, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) throw new Error('aborted');
        const ticket = await new Promise<() => void>((resolve, reject) => {
            const g = this.gate(providerId);
            const waiter: Waiter = { lane, enqueuedAt: this.now(), resolve, reject, ...(signal ? { signal } : {}) };
            const timer = setTimeout(() => {
                const i = g.queue.indexOf(waiter);
                if (i >= 0) g.queue.splice(i, 1);
                reject(new AdmissionTimeout(providerId));
            }, this.maxWaitMs);
            const onAbort = () => {
                const i = g.queue.indexOf(waiter);
                if (i >= 0) g.queue.splice(i, 1);
                clearTimeout(timer);
                reject(new Error('aborted'));
            };
            waiter.onAbort = onAbort;
            waiter.resolve = (t) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(t); };
            signal?.addEventListener('abort', onAbort, { once: true });
            g.queue.push(waiter);
            this.pump(providerId);
        });
        try { return await fn(); } finally { ticket(); }
    }

    queued(providerId: string): number { return this.gate(providerId).queue.length; }
}
