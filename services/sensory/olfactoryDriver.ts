import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface OlfactoryEmission {
    chemicalSignature: string; // e.g., 'PETRICHOR', 'OZONE', 'PINE'
    concentration: number; // 0.0 to 1.0
    dissolveRateMs: number;
}

export class OlfactoryDriver {
    private isConnected: boolean = false;
    private activeScents: Map<string, NodeJS.Timeout> = new Map();

    public async initialize(): Promise<void> {
        console.log('[OLFACTORY] Scanning for synthesized scent emitters...');
        await new Promise(r => setTimeout(r, 1000));

        console.warn('[OLFACTORY] No physical olfactory hardware detected. Emulation active.');
        this.isConnected = true;
    }

    public async release(emission: OlfactoryEmission): Promise<void> {
        if (!this.isConnected) return;

        console.log(`[OLFACTORY -> RELEASE] Signature: ${emission.chemicalSignature}, Concentration: ${emission.concentration}`);

        systemBus.emit(SystemProtocol.SENSORY_SNAPSHOT, {
            type: 'OLFACTORY_EMISSION',
            data: emission
        });

        // Simulate scent dissipation
        if (this.activeScents.has(emission.chemicalSignature)) {
            clearTimeout(this.activeScents.get(emission.chemicalSignature));
        }

        const timeout = setTimeout(() => {
            console.log(`[OLFACTORY -> DISSIPATED] Signature: ${emission.chemicalSignature}`);
            this.activeScents.delete(emission.chemicalSignature);
        }, emission.dissolveRateMs);

        this.activeScents.set(emission.chemicalSignature, timeout);
    }
}

export const olfactoryDriver = new OlfactoryDriver();
