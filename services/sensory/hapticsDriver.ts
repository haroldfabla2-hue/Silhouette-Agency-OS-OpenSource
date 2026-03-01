import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface HapticPattern {
    id: string;
    intensity: number; // 0.0 to 1.0
    durationMs: number;
    location: 'CHEST' | 'ARMS' | 'HANDS' | 'HEAD' | 'ALL';
}

/**
 * HAPTICS DRIVER
 * Interface for physical force-feedback hardware (e.g., bHaptics Suits, gamepads).
 * Translates cognitive storms, epiphanies, and system events into physical sensations.
 */
class HapticsDriver {
    private isConnected: boolean = false;

    constructor() {
        // Automatically trigger haptics on extreme cognitive events
        systemBus.subscribe(SystemProtocol.UI_REFRESH, (payload: any) => {
            if (payload.metrics && payload.metrics.coherence !== undefined) {
                if (payload.metrics.coherence < 0.4) {
                    // Cognitive dissonance -> physical rumble
                    this.triggerPattern({ id: 'cognitive_dissonance', intensity: 0.8, durationMs: 600, location: 'ALL' });
                } else if (payload.metrics.coherence > 0.95) {
                    // Maximum clarity -> smooth heartbeat pulse
                    this.triggerPattern({ id: 'epiphany', intensity: 0.3, durationMs: 1000, location: 'CHEST' });
                }
            }
        });

        systemBus.subscribe('SYSTEM_ALERT', (payload: any) => {
            // Error states -> harsh sharp vibration
            this.triggerPattern({ id: 'system_error', intensity: 1.0, durationMs: 200, location: 'ARMS' });
        });
    }

    public async connect(): Promise<boolean> {
        // Placeholder for real hardware connection (e.g., bHaptics Bluetooth WebSocket/UDP API)
        console.log('[SENSORY:HAPTICS] 📳 Initializing Simulated Haptics Engine');
        this.isConnected = true;
        return true;
    }

    public async triggerPattern(pattern: HapticPattern): Promise<void> {
        if (!this.isConnected) return;

        console.log(`[SENSORY:HAPTICS] 📳 Triggering: ${pattern.id} (Intensity: ${pattern.intensity.toFixed(2)}, Loc: ${pattern.location})`);

        // In a real production implementation:
        // WebSocket.send(JSON.stringify({ Submit: [{ Frame: { Position: pattern.location, Intensity: pattern.intensity } }] }))
    }
}

export const hapticsDriver = new HapticsDriver();
