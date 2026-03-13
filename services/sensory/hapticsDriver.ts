import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface HapticFeedback {
    intensity: number; // 0.0 to 1.0
    pattern: 'PULSE' | 'CONTINUOUS' | 'WAVE' | 'HEARTBEAT';
    durationMs: number;
    location?: string; // E.g., 'LEFT_PALM', 'WRIST'
}

export class HapticsDriver {
    private isConnected: boolean = false;
    private buffer: HapticFeedback[] = [];

    public async initialize(): Promise<void> {
        console.log('[HAPTICS] Scanning for connected biometric/haptic hardware...');
        // Simulating hardware connection delay
        await new Promise(r => setTimeout(r, 1500));

        // In a real scenario, this connects to a local serial port or SDK
        console.warn('[HAPTICS] No physical haptic hardware detected. Running in emulation mode.');
        this.isConnected = true;
    }

    public async emit(feedback: HapticFeedback): Promise<void> {
        if (!this.isConnected) {
            this.buffer.push(feedback);
            return;
        }

        console.log(`[HAPTICS -> EMIT] Pattern: ${feedback.pattern}, Intensity: ${feedback.intensity}, Duration: ${feedback.durationMs}ms`);

        // Emit to system bus so visual UI or testing tools can mock the reaction
        systemBus.emit(SystemProtocol.SENSORY_SNAPSHOT, {
            type: 'HAPTIC_EMISSION',
            data: feedback
        });
    }

    public async triggerHeartbeatPulse(): Promise<void> {
        await this.emit({
            intensity: 0.8,
            pattern: 'HEARTBEAT',
            durationMs: 800
        });
    }
}

export const hapticsDriver = new HapticsDriver();
