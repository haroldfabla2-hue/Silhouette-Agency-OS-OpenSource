/**
 * [PR-1] Durable mission checkpoint (pattern: LangGraph checkpointer /
 * Mastra snapshots / OpenAI RunState — verified in code via REA).
 *
 * The autonomous mission loop kept its entire state in process memory
 * (workflowEngine.pipelineData): a restart mid-mission killed the mission
 * silently. This module persists a serializable snapshot of the mission at
 * every stage transition, so the engine can resume after a restart.
 *
 * Reverse-engineering lesson applied (openai-agents-js src/runState.ts is on
 * schema 1.5 and pays migration cost): the schema is VERSIONED FROM DAY ONE.
 * An unknown version is never resumed — it is preserved under its key and the
 * engine starts IDLE instead of guessing at a foreign shape.
 *
 * Storage: system_config via sqliteService (no new table, per-worker temp DB
 * compatible). Checkpoint writes are best-effort and never block a stage.
 */
import { sqliteService } from './sqliteService';

export const MISSION_CHECKPOINT_SCHEMA_VERSION = 1;

const LATEST_KEY = 'missionCheckpoint:latest';
const keyFor = (missionId: string) => `missionCheckpoint:${missionId}`;

export interface MissionCheckpoint {
    schemaVersion: number;
    missionId: string;
    stage: string;
    pipelineData: Record<string, any>;
    savedAt: number;
}

/**
 * Serializable subset of pipelineData. Only data needed to resume a stage:
 * the mission text, intermediate research/draft, and execution/gate results.
 * Anything not listed (ephemeral thoughts, runtime handles) is rebuilt.
 */
const SERIALIZABLE_FIELDS = [
    'input',
    'missionSource',
    'missionId',
    'intent',
    'researchContext',
    'draftResult',
    'planId',
    'executionResult',
    'verifiedArtifacts',
    'gateReport',
    'qaReport',
    'executionFailed'
] as const;

export function saveMissionCheckpoint(missionId: string, stage: string, pipelineData: Record<string, any>): void {
    try {
        const subset: Record<string, any> = {};
        for (const field of SERIALIZABLE_FIELDS) {
            const value = pipelineData[field];
            if (value === undefined) continue;
            JSON.stringify(value); // fail-fast on non-serializable values
            subset[field] = value;
        }
        const checkpoint: MissionCheckpoint = {
            schemaVersion: MISSION_CHECKPOINT_SCHEMA_VERSION,
            missionId,
            stage,
            pipelineData: subset,
            savedAt: Date.now()
        };
        sqliteService.setConfig(keyFor(missionId), checkpoint);
        sqliteService.setConfig(LATEST_KEY, { missionId, stage, savedAt: checkpoint.savedAt });
    } catch (e: any) {
        console.warn(`[MISSION_CHECKPOINT] Save failed (non-blocking): ${e?.message}`);
    }
}

/**
 * Latest checkpoint, or null. An unknown schemaVersion returns null and the
 * foreign state is LEFT IN PLACE for inspection — never resumed, never deleted.
 */
export function loadLatestMissionCheckpoint(): MissionCheckpoint | null {
    try {
        const latest = sqliteService.getConfig(LATEST_KEY);
        if (!latest?.missionId) return null;
        const checkpoint = sqliteService.getConfig(keyFor(latest.missionId));
        if (!checkpoint || typeof checkpoint !== 'object') return null;
        if (checkpoint.schemaVersion !== MISSION_CHECKPOINT_SCHEMA_VERSION) {
            console.warn(`[MISSION_CHECKPOINT] Unknown schemaVersion ${checkpoint.schemaVersion}; refusing to resume. State preserved under ${keyFor(latest.missionId)}.`);
            return null;
        }
        return checkpoint as MissionCheckpoint;
    } catch {
        return null;
    }
}

/** Mission reached a terminal stage: drop its checkpoint and the latest pointer. */
export function clearMissionCheckpoint(missionId: string): void {
    try {
        sqliteService.setConfig(keyFor(missionId), null);
        const latest = sqliteService.getConfig(LATEST_KEY);
        if (latest?.missionId === missionId) {
            sqliteService.setConfig(LATEST_KEY, null);
        }
    } catch { /* best-effort cleanup */ }
}
