import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface OlfactoryEmission {
    chemicalSignature: string; // e.g., 'PETRICHOR', 'OZONE', 'PINE'
    concentration: number; // 0.0 to 1.0
    dissolveRateMs: number;
}

/**
 * Optional physical scent-emitter backend. Real diffusers can be plugged in via
 * registerBackend(); without one the driver runs as a functional *software*
 * sensory layer with real, queryable scent state and TTL-based dissipation.
 */
export interface OlfactoryBackend {
    name: string;
    diffuse(emission: OlfactoryEmission): Promise<void> | void;
}

interface ActiveScent extends OlfactoryEmission {
    startedAt: number;
    expiresAt: number;
    timeout: NodeJS.Timeout;
}

export class OlfactoryDriver {
    private ready = false;
    private backend: OlfactoryBackend | null = null;
    private activeScents: Map<string, ActiveScent> = new Map();

    public async initialize(): Promise<void> {
        this.ready = true;
        console.log(this.backend
            ? `[OLFACTORY] Initialized with hardware backend: ${this.backend.name}`
            : '[OLFACTORY] Initialized in software mode (no hardware backend registered).');
    }

    public registerBackend(backend: OlfactoryBackend): void {
        this.backend = backend;
        console.log(`[OLFACTORY] Hardware backend registered: ${backend.name}`);
    }

    public hasHardware(): boolean {
        return this.backend !== null;
    }

    public async release(emission: OlfactoryEmission): Promise<void> {
        if (!this.ready) return;

        // Drive real hardware if present.
        if (this.backend) {
            try { await this.backend.diffuse(emission); }
            catch (e: any) { console.warn(`[OLFACTORY] Backend "${this.backend.name}" failed: ${e?.message}`); }
        }

        systemBus.emit(SystemProtocol.SENSORY_SNAPSHOT, { type: 'OLFACTORY_EMISSION', data: emission });

        // Refresh TTL if the same scent is re-released.
        const existing = this.activeScents.get(emission.chemicalSignature);
        if (existing) clearTimeout(existing.timeout);

        const timeout = setTimeout(() => {
            this.activeScents.delete(emission.chemicalSignature);
        }, Math.max(0, emission.dissolveRateMs));
        timeout.unref?.();

        this.activeScents.set(emission.chemicalSignature, {
            ...emission,
            startedAt: Date.now(),
            expiresAt: Date.now() + Math.max(0, emission.dissolveRateMs),
            timeout,
        });
    }

    /** Currently-diffusing scents (names only). */
    public getActiveScents(): string[] {
        return Array.from(this.activeScents.keys());
    }

    /** Snapshot of the olfactory subsystem state (for UI / diagnostics / tests). */
    public getState() {
        const now = Date.now();
        return {
            ready: this.ready,
            hardware: this.backend?.name ?? null,
            active: Array.from(this.activeScents.values())
                .filter(s => s.expiresAt > now)
                .map(({ chemicalSignature, concentration, expiresAt }) => ({
                    chemicalSignature, concentration, remainingMs: Math.max(0, expiresAt - now),
                })),
        };
    }
}

export const olfactoryDriver = new OlfactoryDriver();
