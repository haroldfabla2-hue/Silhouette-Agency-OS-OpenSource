
import { introspection } from '../../services/introspectionEngine';

const HEARTBEAT_INTERVAL = 120000; // 120s (0.5 RPM - optimized for z.ai limits)
const DISCOVERY_INTERVAL = 10; // Every 10 cycles (~5 min), trigger autonomous discovery

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
