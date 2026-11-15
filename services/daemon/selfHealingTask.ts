import { DaemonTask } from './unifiedDaemon';
import { daemonLog } from '../logger';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * SELF-HEALING KERNEL TASK (Phase 19 - Unified)
 * 
 * Reads `logs/system_errors.log` every 15 minutes.
 * Instead of dispatching directly to the Orchestrator (which was redundant
 * with the existing LearningLoop), this task now feeds errors as structured
 * Experience objects into the LearningLoop's failure analysis pipeline.
 * 
 * The LearningLoop then:
 * 1. Groups failures by context
 * 2. Detects recurring patterns (min 3 occurrences)
 * 3. Uses backgroundLLM to generate a root-cause analysis
 * 4. Auto-applies safe fixes (confidence > 0.75)
 * 5. Persists insights to eternal memory
 */
export const selfHealingTask: DaemonTask = {
    name: 'Self-Healing Kernel',
    intervalMs: 15 * 60 * 1000, // Every 15 minutes

    execute: async () => {
        daemonLog.info({}, 'Self-Healing: Scanning system_errors.log');

        try {
            const logPath = path.resolve(process.cwd(), 'logs', 'system_errors.log');
            let content = '';

            try {
                content = await fs.readFile(logPath, 'utf8');
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    // [R6] a missing log file means this SOURCE is unavailable,
                    // not that the system is healthy. Say so honestly and still
                    // check the durable incident registry below.
                    daemonLog.warn({}, 'Self-Healing: error log source unavailable (no system_errors.log) - NOT the same as zero errors.');
                } else {
                    throw err;
                }
            }

            // [R6] durable incidents (Neo4j/Redis outages, perception gaps) are
            // real failures even when the file log is empty or missing.
            const { incidentRegistry } = await import('../incidentRegistry');
            const openIncidents = incidentRegistry.getOpenIncidents();

            const lines = content.split('\n').filter(Boolean);
            // Even an episode resolved before this sweep must reach canonical
            // ingestion. A healthy empty analysis is explicit, not an early return.

            daemonLog.warn({}, `Self-Healing: Found ${lines.length} error entries and ${openIncidents.length} open incident(s). Checking canonical incident analysis; log text is diagnostic only.`);

            // Dynamically import LearningLoop to avoid circular dependencies
            const { learningLoop } = await import('../learningLoop');

            // Canonical mapped incidents are read/deduped by analysis itself.
            // Raw file lines lack an immutable event ID: retain diagnostics but
            // do not manufacture FAILURE experiences or clear another writer's log.

            // Trigger an immediate analysis cycle on these fresh errors
            const analysis = await learningLoop.analyzeFailures(15 * 60 * 1000);
            if (analysis.status !== 'COMPLETE') throw new Error(`${analysis.status}: ${analysis.detail}`);
            const insights = analysis.insights;

            // [SECURITY] Auto-applying a fix IS evolution: respect the same
            // operator authority (autonomy.allowEvolution) that gates the
            // evolution tasks. Ingestion/analysis above stay maintenance and
            // always run; the mutation does not. Fail-closed if config is
            // unreadable. Insights are still generated and persisted.
            let autoApplyAllowed = false;
            try {
                const { configLoader } = await import('../../server/config/configLoader');
                const { isAutoApplyAllowed } = await import('./autonomyPolicy');
                autoApplyAllowed = isAutoApplyAllowed(configLoader.getConfig().autonomy as any);
            } catch (cfgErr: any) {
                daemonLog.error({}, `Self-Healing: could not read autonomy config; auto-apply DISABLED (fail-closed): ${cfgErr?.message || cfgErr}`);
            }

            let appliedCount = 0;
            if (!autoApplyAllowed && insights.length > 0) {
                daemonLog.info({}, `Self-Healing: ${insights.length} insight(s) generated; auto-apply DISABLED by autonomy.allowEvolution (recorded, not applied).`);
            }
            for (const insight of insights) {
                if (autoApplyAllowed && insight.autoApplicable && insight.confidence > 0.75) {
                    const outcome = await learningLoop.routeInsight(insight);
                    if (outcome.applied) appliedCount++;
                    daemonLog.info({}, `Self-Healing: insight ${outcome.stage}; applied=${outcome.applied}.`);
                }
            }

            // Raw log lines have no immutable event identity. Retain them rather
            // than pretending ingestion acknowledged them or truncating concurrent
            // writes. Log rotation/identity ingestion is a separate contract.

            daemonLog.info({}, `Self-Healing: Cycle complete. ${insights.length} insights, ${appliedCount} auto-applied.`);

        } catch (error: any) {
            daemonLog.error({ error: error.message }, 'Self-Healing task failed.');
        }
    }
};
