
import fs from 'fs';
import { PATHS } from '../config/paths';
import { costEstimator } from '../../services/costEstimator';
import { workflowEngine } from '../../services/workflowEngine';
import { sqliteService } from '../../services/sqliteService';

function getIntervalFromEnv(name: string, fallbackMs: number): number {
    const raw = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : fallbackMs;
}

const COST_METRICS_SAVE_INTERVAL_MS = getIntervalFromEnv('COST_METRICS_SAVE_INTERVAL_MS', 60000);
const WORKFLOW_TICK_INTERVAL_MS = getIntervalFromEnv('WORKFLOW_TICK_INTERVAL_MS', 5000);

export const startPersistenceJobs = () => {
    console.log('[JOB] 💾 Persistence & Cleanup Jobs Started.');

    // 1. Cost Metrics Saver
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
    }, COST_METRICS_SAVE_INTERVAL_MS);

    // 2. Workflow Tick
    // Orchestrator and Continuum maintenance already run from the orchestrator loop.
    // Keeping a second tick here caused duplicated work and unnecessary CPU churn.
    setInterval(() => {
        workflowEngine.tick();

        // Auto-save State every 5s
        if (Date.now() % 5000 < 1000) {
            // TODO: Move this saveStateToDisk logic here fully eventually
            // currently relies on the monolithic function in index.ts
            // We can emit an event here if we want to decouple
        }
    }, WORKFLOW_TICK_INTERVAL_MS);
};
