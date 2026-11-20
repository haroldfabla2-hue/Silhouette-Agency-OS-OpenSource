import fs from 'fs';
import { PATHS } from '../config/paths';
import { costEstimator } from '../../services/costEstimator';
import { sqliteService } from '../../services/sqliteService';
import { ownedInterval } from '../desktop/producerScope.js';

/** Actual timer callback, shared by startup and direct service validation. */
export function saveCostMetricsOnce(): void {
    try {
        const metrics = costEstimator.getMetrics();
        // Preserve legacy JSON first, then actual SQLite, including failure semantics.
        fs.writeFileSync(PATHS.COST_METRICS_FILE, JSON.stringify(metrics, null, 2));
        sqliteService.saveCostMetrics(metrics);
    } catch (e) {
        console.error("[JOB] Failed to save cost metrics", e);
    }
}

export function startCostPersistenceJob(): void {
    ownedInterval(saveCostMetricsOnce, 10000);
}
