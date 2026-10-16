/**
 * [PR-1] Mission real-execution tests.
 *
 * Covers the three PR-1 mechanisms in isolation (no LLM, no network):
 *  1. missionGate: the deterministic tripwire — build mission + zero
 *     verified artifacts = HALT with a structured report; artifacts = PASS;
 *     non-file mission = PASS without artifact demand.
 *  2. taskLedger: every PlanStep becomes a tasks row (work as data, D4 fix),
 *     with pending -> running -> completed/failed transitions.
 *  3. missionCheckpoint: durable snapshot roundtrip; unknown schemaVersion
 *     is never resumed; terminal clear retires the state.
 *
 * Uses the per-worker temp sqlite (tests/setup/sqlite-per-worker.ts).
 */
import { describe, it, expect } from 'vitest';
import {
    evaluateMissionGate,
    missionDeclaresFileWork,
} from '../../services/execution/missionGate';
import {
    saveMissionCheckpoint,
    loadLatestMissionCheckpoint,
    clearMissionCheckpoint,
    MISSION_CHECKPOINT_SCHEMA_VERSION as CP_VERSION
} from '../../services/missionCheckpoint';
import { recordPlanTasks, markTaskRunning, markTaskDone, taskIdFor } from '../../services/execution/taskLedger';
import { sqliteService } from '../../services/sqliteService';
import type { ExecutionPlan } from '../../services/planGenerator';

const BUILD_MISSION = 'Crea un cotizador web simple para freelancers y entrega el HTML completo en el workspace';
const RESEARCH_MISSION = 'Investiga las tendencias de precios de hosting en 2026 y dame un resumen';

describe('[PR-1] missionGate (deterministic tripwire)', () => {
    it('detects file-work declarations in Spanish and English', () => {
        expect(missionDeclaresFileWork(BUILD_MISSION)).toBe(true);
        expect(missionDeclaresFileWork('Build a landing page')).toBe(true);
        expect(missionDeclaresFileWork(RESEARCH_MISSION)).toBe(false);
    });

    it('HALTs a build mission with zero verified artifacts, with structured report', () => {
        const report = evaluateMissionGate(BUILD_MISSION, {
            planId: 'plan_test1',
            success: false,
            artifactsProduced: [],
            steps: [
                { stepOrder: 1, agentId: 'dev-01', success: true },
                { stepOrder: 2, agentId: 'dev-02', success: false, error: 'tool denied' }
            ]
        });
        expect(report.verdict).toBe('HALT');
        expect(report.gate).toBe('ARTIFACT_VERIFICATION');
        expect(report.declaredFileWork).toBe(true);
        expect(report.verifiedArtifacts).toEqual([]);
        expect(report.missing).toContain('zero verified writes');
        expect(report.missing).toContain('plan_test1');
        expect(report.stepOutcomes).toHaveLength(2);
        expect(report.stepOutcomes[1].error).toBe('tool denied');
    });

    it('PASSes a build mission with verified artifacts', () => {
        const report = evaluateMissionGate(BUILD_MISSION, {
            planId: 'plan_test2',
            success: true,
            artifactsProduced: [{ path: '/opt/silhouette/workspace/cotizador/index.html' }],
            steps: [{ stepOrder: 1, agentId: 'dev-01', success: true }]
        });
        expect(report.verdict).toBe('PASS');
        expect(report.verifiedArtifacts).toEqual(['/opt/silhouette/workspace/cotizador/index.html']);
        expect(report.missing).toBe('');
    });

    it('PASSes a research mission without demanding artifacts', () => {
        const report = evaluateMissionGate(RESEARCH_MISSION, {
            planId: 'plan_test3',
            artifactsProduced: [],
            steps: [{ stepOrder: 1, agentId: 'sci-01', success: true }]
        });
        expect(report.verdict).toBe('PASS');
        expect(report.declaredFileWork).toBe(false);
    });

    it('HALTs when the build stage produced no execution result at all', () => {
        const report = evaluateMissionGate(BUILD_MISSION, null);
        expect(report.verdict).toBe('HALT');
        expect(report.missing).toContain('no execution result');
    });
});

describe('[PR-1] taskLedger (work as data, D4 fix)', () => {
    const plan: ExecutionPlan = {
        id: 'plan_ledger1',
        originalRequest: BUILD_MISSION,
        intent: 'build',
        complexity: 'MODERATE',
        steps: [
            { order: 1, agentId: 'dev-01', agentRole: 'Dev', taskDescription: 'Design page', dependsOn: [], priority: 'NORMAL', estimatedTokens: 100, requiredCapabilities: [] },
            { order: 2, agentId: 'dev-02', agentRole: 'Dev', taskDescription: 'Write HTML file', dependsOn: [1], priority: 'CRITICAL', estimatedTokens: 200, requiredCapabilities: [] }
        ],
        estimatedTotalTokens: 300,
        estimatedRPM: 2,
        createdAt: Date.now()
    };

    it('records one pending task per step, then transitions them', () => {
        recordPlanTasks(plan);
        let rows = sqliteService.getTasksByPlan(plan.id);
        expect(rows).toHaveLength(2);
        expect(rows.map((r: any) => r.status)).toEqual(['pending', 'pending']);
        expect(rows[0].id).toBe(taskIdFor(plan.id, 1));

        const createdAt = rows[0].created_at;
        markTaskRunning(plan.id, plan.steps[0]);
        markTaskDone(plan.id, plan.steps[0], { stepOrder: 1, success: true, artifacts: ['/w/a.html'], tokensUsed: 50, executionTimeMs: 10 });
        markTaskDone(plan.id, plan.steps[1], { stepOrder: 2, success: false, error: 'boom' });

        rows = sqliteService.getTasksByPlan(plan.id);
        const byOrder = (o: number) => rows.find((r: any) => JSON.parse(r.data).stepOrder === o);
        expect(byOrder(1).status).toBe('completed');
        expect(JSON.parse(byOrder(1).data).artifacts).toEqual(['/w/a.html']);
        expect(byOrder(2).status).toBe('failed');
        expect(JSON.parse(byOrder(2).data).error).toBe('boom');
        // created_at survives upserts (immutable birth record)
        expect(byOrder(1).created_at).toBe(createdAt);
    });
});

describe('[PR-1] missionCheckpoint (durable state, versioned from day one)', () => {
    it('roundtrips a mission snapshot and clears it on terminal', () => {
        const pipeline = { input: BUILD_MISSION, missionSource: 'api', intent: 'build', planId: 'plan_cp1' };
        saveMissionCheckpoint('msn_cp1', 'EXECUTION_SWARM', pipeline);

        const loaded = loadLatestMissionCheckpoint();
        expect(loaded).not.toBeNull();
        expect(loaded!.schemaVersion).toBe(CP_VERSION);
        expect(loaded!.missionId).toBe('msn_cp1');
        expect(loaded!.stage).toBe('EXECUTION_SWARM');
        expect(loaded!.pipelineData.planId).toBe('plan_cp1');

        clearMissionCheckpoint('msn_cp1');
        expect(loadLatestMissionCheckpoint()).toBeNull();
    });

    it('never resumes an unknown schemaVersion (state preserved, no crash)', () => {
        saveMissionCheckpoint('msn_cp2', 'QUALITY_ASSURANCE_AUDIT', { input: 'x' });
        // Corrupt the stored version as a foreign future schema would look
        sqliteService.setConfig('missionCheckpoint:msn_cp2', {
            schemaVersion: CP_VERSION + 99,
            missionId: 'msn_cp2',
            stage: 'QUALITY_ASSURANCE_AUDIT',
            pipelineData: {},
            savedAt: Date.now()
        });
        expect(loadLatestMissionCheckpoint()).toBeNull();
        // Foreign state is still there for inspection
        const preserved = sqliteService.getConfig('missionCheckpoint:msn_cp2');
        expect(preserved.schemaVersion).toBe(CP_VERSION + 99);
        clearMissionCheckpoint('msn_cp2');
    });
});
