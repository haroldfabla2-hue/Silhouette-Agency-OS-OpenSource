import { orderedFanout } from '../desktop/orderedFanout.js';
import { ownedInterval, producerScopeBound } from '../desktop/producerScope.js';

import { startCostPersistenceJob } from './costPersistence';
import { workflowEngine } from '../../services/workflowEngine';
import { orchestrator } from '../../services/orchestrator';
import { continuum } from '../../services/continuumMemory';

export const startPersistenceJobs = () => {
    console.log('[JOB] 💾 Persistence & Cleanup Jobs Started.');

    // 1. Cost Metrics Saver (Every 10s), same actual dual-write implementation.
    startCostPersistenceJob();

    // 2. High-Frequency System Tick (Every 1s)
    ownedInterval(() => {
        if (producerScopeBound()) {
            // Same invocation order/concurrent work, stop on synchronous throw. Return started promises to
            // the desktop timer owner. Unbound native CLI path stays unchanged.
            return orderedFanout([() => workflowEngine.tick(), () => orchestrator.tick(), () => continuum.runMaintenance()]);
        }
        workflowEngine.tick();
        orchestrator.tick();
        continuum.runMaintenance();

        // Auto-save State every 5s
        if (Date.now() % 5000 < 1000) {
            // TODO: Move this saveStateToDisk logic here fully eventually
            // currently relies on the monolithic function in index.ts
            // We can emit an event here if we want to decouple
        }
    }, 1000);
};
