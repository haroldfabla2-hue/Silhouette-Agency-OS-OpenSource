import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface HapticFeedback {
    intensity: number; // 0.0 to 1.0
    pattern: 'PULSE' | 'CONTINUOUS' | 'WAVE' | 'HEARTBEAT';
    durationMs: number;
    location?: string; // E.g., 'LEFT_PALM', 'WRIST'
}

/**
 * Optional physical-hardware backend. Real haptic devices (serial/BLE/SDK) can
 * be plugged in via registerBackend(); without one, the driver runs as a fully
 * functional *software* sensory layer (queryable state + event bus), which is
 * what the UI's SENSORY_SNAPSHOT consumes.
 */
export interface HapticsBackend {
    name: string;
    play(feedback: HapticFeedback): Promise<void> | void;
}

interface ActiveHaptic extends HapticFeedback {
    id: string;
    startedAt: number;
    expiresAt: number;
}

export class HapticsDriver {
    private ready = false;
    private backend: HapticsBackend | null = null;
    private buffer: HapticFeedback[] = [];
    private active: Map<string, ActiveHaptic> = new Map();
    private history: ActiveHaptic[] = [];
    private seq = 0;

    public async initialize(): Promise<void> {
        this.ready = true;
        if (this.backend) {
            console.log(`[HAPTICS] Initialized with hardware backend: ${this.backend.name}`);
        } else {
            console.log('[HAPTICS] Initialized in software mode (no hardware backend registered).');
        }
        await this.flushBuffer();
    }

    /** Attach a real hardware backend (e.g. a serial/BLE device driver). */
    public registerBackend(backend: HapticsBackend): void {
        this.backend = backend;
        console.log(`[HAPTICS] Hardware backend registered: ${backend.name}`);
        if (this.ready) void this.flushBuffer();
    }

    public hasHardware(): boolean {
        return this.backend !== null;
    }

    private async flushBuffer(): Promise<void> {
        if (!this.buffer.length) return;
        const pending = this.buffer.splice(0);
        for (const fb of pending) await this.emit(fb);
    }

    public async emit(feedback: HapticFeedback): Promise<void> {
        if (!this.ready) {
            this.buffer.push(feedback);
            return;
        }

        const entry: ActiveHaptic = {
            ...feedback,
            id: `hap_${++this.seq}`,
            startedAt: Date.now(),
            expiresAt: Date.now() + Math.max(0, feedback.durationMs),
        };

        // Track real, queryable active state with TTL expiry.
        this.active.set(entry.id, entry);
        setTimeout(() => this.active.delete(entry.id), Math.max(0, feedback.durationMs)).unref?.();

        this.history.push(entry);
        if (this.history.length > 200) this.history = this.history.slice(-100);

        // Drive real hardware if present.
        if (this.backend) {
            try { await this.backend.play(feedback); }
            catch (e: any) { console.warn(`[HAPTICS] Backend "${this.backend.name}" failed: ${e?.message}`); }
        }

        systemBus.emit(SystemProtocol.SENSORY_SNAPSHOT, { type: 'HAPTIC_EMISSION', data: feedback });
    }

    public async triggerHeartbeatPulse(): Promise<void> {
        await this.emit({ intensity: 0.8, pattern: 'HEARTBEAT', durationMs: 800 });
    }

    /** Currently-active (non-expired) haptic emissions. */
    public getActiveEmissions(): ActiveHaptic[] {
        const now = Date.now();
        return Array.from(this.active.values()).filter(a => a.expiresAt > now);
    }

    /** Snapshot of the haptic subsystem state (for UI / diagnostics / tests). */
    public getState() {
        return {
            ready: this.ready,
            hardware: this.backend?.name ?? null,
            active: this.getActiveEmissions(),
            emitted: this.history.length,
        };
    }
}

export const hapticsDriver = new HapticsDriver();
