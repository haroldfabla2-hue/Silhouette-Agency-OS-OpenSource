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

            // [SECURITY] Autonomy ceiling: this job is a SECOND entry point for
            // proactive cognition (the unifiedDaemon is the first, and it is
            // gated). The ceiling must hold on every route, so each cycle
            // re-reads the operator config and runs only what is allowed.
            // Fail-closed: unreadable config skips the proactive cycle.
            const { configLoader } = await import('../config/configLoader');
            const { isTaskAllowedByAutonomy } = await import('../../services/daemon/autonomyPolicy');
            let autonomyFlags: any;
            try {
                autonomyFlags = configLoader.getConfig().autonomy;
            } catch (cfgErr: any) {
                console.warn('[HEARTBEAT] ⛔ Autonomy config unreadable; skipping proactive cycle (fail-closed):', cfgErr?.message || cfgErr);
                return;
            }

            // Run Cognitive Cycle (Observe -> Orient -> Decide -> Act).
            // Introspection is governed by autonomy.enableIntrospection; the
            // engine re-checks at its own chokepoint, this pre-check only
            // avoids a skip-log every 120s.
            if (isTaskAllowedByAutonomy('Introspection', autonomyFlags)) {
                await introspection.runCognitiveCycle();
            }

            // Autonomous Discovery: Explore knowledge gaps occasionally.
            // Same capability as the daemon's 'Curiosity' task - same flag.
            cycleCount++;
            if (cycleCount % DISCOVERY_INTERVAL === 0) {
                // Also check congestion before discovery
                if (!congestionManager.isCongested() && isTaskAllowedByAutonomy('Curiosity', autonomyFlags)) {
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
