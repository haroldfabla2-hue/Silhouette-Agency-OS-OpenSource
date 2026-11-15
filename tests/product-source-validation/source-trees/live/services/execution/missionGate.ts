/**
 * [PR-1] Deterministic mission gate (tripwire semantics).
 *
 * Reverse-engineering evidence (openai-agents-js src/guardrail.ts): a guardrail
 * is a CODE function whose tripwire HALTS execution with structured outputInfo;
 * it is never "another LLM opinion". This module is that gate for missions.
 *
 * The question it answers is binary: a mission that declared file-producing
 * work MUST end with verified writes in the fs jail audit journal. Zero
 * verified writes = HALT with a structured report (what was verified, what is
 * missing) that remediation consumes verbatim — not prose to re-opine on.
 *
 * Pure and dependency-light by design (unit-tested without booting services).
 */
import { FILE_WORK_PATTERN } from '../tools/toolSelection';

/**
 * The shared FILE_WORK_PATTERN matches infinitives ("crear", "build") but not
 * the Spanish imperatives/conjugations real missions arrive in ("Crea un
 * cotizador web" matched NOTHING — caught by this module's own unit test).
 * The mission gate widens detection with conjugated Spanish verbs and
 * artifact nouns; the shared pattern stays untouched so tool-grant
 * heuristics elsewhere keep their exact current behavior.
 */
const MISSION_FILE_WORK_PATTERN = new RegExp(
    FILE_WORK_PATTERN.source +
    '|crea|haz|construye|genera|escribe|desarrolla|programa|implementa|dise[ñn]a' +
    '|html|css|javascript|typescript|workspace|entrega|deliverable',
    'i'
);

export interface MissionExecutionSummary {
    planId?: string;
    success?: boolean;
    artifactsProduced?: Array<{ path: string } | string>;
    errors?: string[];
    steps?: Array<{ stepOrder: number; agentId: string; success: boolean; error?: string }>;
}

export interface MissionGateReport {
    gate: 'ARTIFACT_VERIFICATION';
    verdict: 'HALT' | 'PASS';
    declaredFileWork: boolean;
    verifiedArtifacts: string[];
    planId?: string;
    stepOutcomes: Array<{ stepOrder: number; agentId: string; success: boolean; error?: string }>;
    /** Empty on PASS; on HALT the exact verification failure, for remediation. */
    missing: string;
}

/** Missions whose text declares build work must produce artifacts. */
export function missionDeclaresFileWork(missionText: string): boolean {
    return MISSION_FILE_WORK_PATTERN.test(missionText || '');
}

export function evaluateMissionGate(
    missionText: string,
    execution: MissionExecutionSummary | null | undefined
): MissionGateReport {
    const declaredFileWork = missionDeclaresFileWork(missionText);
    const verifiedArtifacts = (execution?.artifactsProduced ?? [])
        .map(a => (typeof a === 'string' ? a : a?.path))
        .filter((p): p is string => !!p);
    const stepOutcomes = (execution?.steps ?? []).map(s => ({
        stepOrder: s.stepOrder,
        agentId: s.agentId,
        success: s.success,
        error: s.error
    }));

    const base = {
        gate: 'ARTIFACT_VERIFICATION' as const,
        declaredFileWork,
        verifiedArtifacts,
        planId: execution?.planId,
        stepOutcomes
    };

    if (!declaredFileWork) {
        // Analysis/research missions carry no artifact requirement; the LLM
        // audit still reviews content, but the gate does not demand files.
        return { ...base, verdict: 'PASS', missing: '' };
    }

    if (verifiedArtifacts.length === 0) {
        const missing = execution
            ? `Mission declared file-producing work but zero verified writes were recorded by the fs jail (plan ${execution.planId ?? 'unknown'}, ${stepOutcomes.length} steps run, ${stepOutcomes.filter(s => s.success).length} succeeded).`
            : 'Mission declared file-producing work but the build stage produced no execution result at all.';
        return { ...base, verdict: 'HALT', missing };
    }

    return { ...base, verdict: 'PASS', missing: '' };
}
