import { runSqliteOperation } from '../../services/lifecycle/sqliteAdmission';
import { startCostMetricsTimer, startSystemTickTimer } from '../lifecycle/bootTimers';

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
    startCostMetricsTimer(() => {
        return runSqliteOperation('server/jobs/persistence.ts:original-callback-15', () => {
        try {
            const metrics = costEstimator.getMetrics();
            // Dual write for migration safety:
            // 1. JSON (Deprecated)
            fs.writeFileSync(PATHS.COST_METRICS_FILE, JSON.stringify(metrics, null, 2));
            // 2. SQLite (New)
            sqliteService.saveCostMetrics(metrics);
        } catch (e) {
            console.error("[JOB] Failed to save cost metrics", e);
            throw e; // actual failed write remains owner-integrity evidence
        }
    
        });
    }, 10000);

    // 2. High-Frequency System Tick (Every 1s)
    startSystemTickTimer(async () => {
        // Retain every original branch before observing failures. A sync throw
        // in one branch cannot suppress independent original work.
        const originals: Promise<unknown>[]=[];
        for(const run of [()=>workflowEngine.tick(),()=>orchestrator.tick(),()=>continuum.runMaintenance()]) {
            try {originals.push(Promise.resolve(run()));}
            catch(error) {originals.push(Promise.reject(error));}
        }
        const results=await Promise.allSettled(originals);
        const failures=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected');
        if(failures.length)throw new AggregateError(failures.map(r=>r.reason),'Original system tick branches failed');

        // Auto-save State every 5s
        if (Date.now() % 5000 < 1000) {
            // TODO: Move this saveStateToDisk logic here fully eventually
            // currently relies on the monolithic function in index.ts
            // We can emit an event here if we want to decouple
        }
    }, 1000);
};
