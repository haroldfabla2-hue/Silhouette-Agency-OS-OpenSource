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
                    daemonLog.debug({}, 'Self-Healing: No error log found. System healthy.');
                    return;
                }
                throw err;
            }

            if (!content || content.trim() === '') {
                daemonLog.debug({}, 'Self-Healing: No trailing errors.');
                return;
            }

            // Parse structured JSON log lines into Experience objects
            const lines = content.split('\n').filter(Boolean);

            if (lines.length === 0) return;

            daemonLog.warn({}, `Self-Healing: Found ${lines.length} error entries. Feeding to LearningLoop.`);

            // Dynamically import LearningLoop to avoid circular dependencies
            const { learningLoop } = await import('../learningLoop');

            // Feed each error as a failure experience
            const { continuum } = await import('../continuumMemory');

            for (const line of lines.slice(-50)) { // Process last 50 errors max
                try {
                    const entry = JSON.parse(line);
                    // Store as a failure experience in Continuum Memory
                    // so LearningLoop can pick it up during its next analyzeFailures() call
                    await continuum.store(
                        `SYSTEM_ERROR [${entry.level}]: ${entry.msg}`,
                        undefined,
                        ['system_error', 'self_healing', entry.level || 'error'],
                        false // Not critical enough for eternal memory yet
                    );
                } catch (parseErr) {
                    // Skip malformed lines
                }
            }

            // Trigger an immediate analysis cycle on these fresh errors
            const insights = await learningLoop.analyzeFailures(15 * 60 * 1000); // Last 15 min window

            let appliedCount = 0;
            for (const insight of insights) {
                if (insight.autoApplicable && insight.confidence > 0.75) {
                    const applied = await learningLoop.applyInsight(insight);
                    if (applied) appliedCount++;
                }
            }

            // Clear the log file to prevent re-processing
            await fs.writeFile(logPath, '', 'utf8');

            daemonLog.info({}, `Self-Healing: Cycle complete. ${insights.length} insights, ${appliedCount} auto-applied.`);

        } catch (error: any) {
            daemonLog.error({ error: error.message }, 'Self-Healing task failed.');
        }
    }
};
