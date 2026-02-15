/**
 * Congestion Manager - Backpressure System
 * 
 * Purpose:
 * - Track queue size across the system
 * - Signal congestion to background tasks (pause when queue grows)
 * - Never lose requests - queue everything
 * 
 * NOTE: Token bucket rate limiting is now handled PER-KEY in zhipuService.ts
 */

interface CongestionState {
    queueSize: number;
    isCongested: boolean;
    lastUpdate: number;
    pausedSince: number | null;
}

class CongestionManager {
    // Configuration
    private readonly CONFIG = {
        // Queue thresholds
        CONGESTION_THRESHOLD: 10,    // Start congestion at 10 queued
        CLEAR_THRESHOLD: 5,          // Clear congestion at 5 queued
        MAX_QUEUE_SIZE: 50,          // Hard limit (still process, just warn)
    };

    // State
    private state: CongestionState = {
        queueSize: 0,
        isCongested: false,
        lastUpdate: Date.now(),
        pausedSince: null
    };

    constructor() {
        console.log('[CONGESTION] 🚦 Backpressure Manager initialized (queue tracking only)');
    }

    /**
     * Report queue size change
     */
    public updateQueueSize(delta: number) {
        this.state.queueSize = Math.max(0, this.state.queueSize + delta);
        this.state.lastUpdate = Date.now();

        // Check congestion state
        if (!this.state.isCongested && this.state.queueSize >= this.CONFIG.CONGESTION_THRESHOLD) {
            this.state.isCongested = true;
            this.state.pausedSince = Date.now();
            console.warn(`[CONGESTION] 🚨 CONGESTED - Queue: ${this.state.queueSize}/${this.CONFIG.MAX_QUEUE_SIZE}`);
        } else if (this.state.isCongested && this.state.queueSize <= this.CONFIG.CLEAR_THRESHOLD) {
            const pauseDuration = this.state.pausedSince ? (Date.now() - this.state.pausedSince) / 1000 : 0;
            this.state.isCongested = false;
            this.state.pausedSince = null;
            console.log(`[CONGESTION] ✅ CLEAR - Queue: ${this.state.queueSize}. Paused for ${pauseDuration.toFixed(1)}s`);
        }
    }

    /**
     * Check if system is congested (background tasks should pause)
     */
    public isCongested(): boolean {
        return this.state.isCongested;
    }

    /**
     * Get current queue size
     */
    public getQueueSize(): number {
        return this.state.queueSize;
    }

    /**
     * Get full status for debugging
     */
    public getStatus(): {
        queueSize: number;
        maxQueue: number;
        isCongested: boolean;
    } {
        return {
            queueSize: this.state.queueSize,
            maxQueue: this.CONFIG.MAX_QUEUE_SIZE,
            isCongested: this.state.isCongested
        };
    }
}

// Singleton instance
export const congestionManager = new CongestionManager();
