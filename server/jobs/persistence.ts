
import fs from 'fs';
import { PATHS } from '../config/paths';
import { costEstimator } from '../../services/costEstimator';
import { workflowEngine } from '../../services/workflowEngine';
import { orchestrator } from '../../services/orchestrator';
import { continuum } from '../../services/continuumMemory';
import { sqliteService } from '../../services/sqliteService';

export const startPersistenceJobs = () => {
    console.log('[JOB] 💾 Persistence & Cleanup Jobs Started.');

    // 1. Cost Metrics Saver (Every 10s)
    setInterval(() => {
        try {
            const metrics = costEstimator.getMetrics();
            // Dual write for migration safety:
            // 1. JSON (Deprecated)
            fs.writeFileSync(PATHS.COST_METRICS_FILE, JSON.stringify(metrics, null, 2));
            // 2. SQLite (New)
            sqliteService.saveCostMetrics(metrics);
        } catch (e) {
            console.error("[JOB] Failed to save cost metrics", e);
        }
    }, 10000);

    // 2. High-Frequency System Tick (Every 1s)
    setInterval(() => {
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
