
import { introspection } from '../../services/introspectionEngine';

function getPositiveEnvNumber(name: string, fallback: number): number {
    const raw = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const HEARTBEAT_INTERVAL = getPositiveEnvNumber('AUTONOMOUS_HEARTBEAT_INTERVAL_MS', 120000);
const DISCOVERY_INTERVAL = getPositiveEnvNumber('AUTONOMOUS_DISCOVERY_CYCLE_COUNT', 10);

let cycleCount = 0;

export const startHeartbeat = () => {
    console.log('[JOB] ❤️ Autonomous Heartbeat Started.');
    setInterval(async () => {
        try {
            // Check congestion before running cycle
            const { congestionManager } = await import('../../services/congestionManager');
            if (congestionManager.isCongested()) {
                console.log('[HEARTBEAT] ⏸️ Paused (system congested). Will retry next cycle.');
                return;
            }

            // Run Cognitive Cycle (Observe -> Orient -> Decide -> Act)
            await introspection.runCognitiveCycle();

            // Autonomous Discovery: Explore knowledge gaps occasionally
            cycleCount++;
            if (cycleCount % DISCOVERY_INTERVAL === 0) {
                // Also check congestion before discovery
                if (!congestionManager.isCongested()) {
                    console.log('[JOB] 🔬 Triggering Autonomous Discovery Cycle...');
                    const { neuroCognitive } = await import('../../services/neuroCognitiveService');
                    await neuroCognitive.triggerDiscoveryCycle();
                }
            }
        } catch (e) {
            console.error("[HEARTBEAT] ❤️‍🔥 Arrhythmia:", e);
        }
    }, HEARTBEAT_INTERVAL);
};
