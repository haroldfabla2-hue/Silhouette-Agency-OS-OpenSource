/**
 * Autonomy task policy - the real readers for `autonomy.*` config.
 *
 * Before this change `autonomy.enabled` (and the granular flags) in
 * silhouette.config.json had ZERO readers: the unified daemon started every
 * proactive task unconditionally. This module maps each daemon task to the
 * config flag that governs it. Maintenance tasks (Self_Healing, Janitor) are
 * not autonomy and always run; proactive tasks that wake agents, evolve the
 * system or narrate run only when the operator explicitly enabled them.
 *
 * Pure and dependency-free so the policy is directly unit-testable.
 */
export interface AutonomyFlags {
    /** MASTER switch for proactive autonomy. false disables every proactive
     *  task and every autonomous mutation, regardless of sub-flags. */
    enabled: boolean;
    /** Sub-flag: autonomous evolution/self-modification. Requires enabled. */
    allowEvolution: boolean;
    /** Sub-flag: narrator task. Requires enabled. */
    enableNarrative: boolean;
    /** Sub-flag: introspection (OODA cognitive cycles). Requires enabled.
     *  Read at the introspectionEngine.runCognitiveCycle chokepoint, so every
     *  route into the engine (daemon task, heartbeat job, HTTP trigger) is
     *  governed. */
    enableIntrospection: boolean;
}

/** Proactive task name -> the autonomy flag that enables it. */
export const PROACTIVE_TASK_FLAGS: Readonly<Record<string, keyof AutonomyFlags>> = Object.freeze({
    Heartbeat: 'enabled',
    Curiosity: 'enabled',
    Dreamer: 'enabled',
    Narrator: 'enableNarrative',
    Introspection: 'enableIntrospection',
    Evolution_Goals: 'allowEvolution',
    Tool_Evolution: 'allowEvolution',
    SelfDev: 'allowEvolution',
});

/**
 * True when the task may run under the given flags. Explicit semantics:
 * `enabled` is the MASTER switch - a proactive task needs the master AND its
 * sub-flag (tasks mapped to 'enabled' need the master alone). The master in
 * false always wins: no sub-flag can re-enable proactive autonomy while the
 * operator has autonomy off. Tasks not listed in PROACTIVE_TASK_FLAGS are
 * maintenance work and are always allowed.
 */
export function isTaskAllowedByAutonomy(taskName: string, flags: AutonomyFlags): boolean {
    const flag = PROACTIVE_TASK_FLAGS[taskName];
    if (!flag) return true;
    if (!flags.enabled) return false;
    return !!flags[flag];
}

/**
 * Auto-applying a generated fix IS evolution (it mutates how the system
 * behaves), so it requires the master switch AND allowEvolution - even when
 * it happens inside a maintenance task (Self-Healing) that itself always
 * runs. Ingestion and analysis stay maintenance; the mutation does not.
 */
export function isAutoApplyAllowed(flags: AutonomyFlags): boolean {
    return !!flags.enabled && !!flags.allowEvolution;
}
