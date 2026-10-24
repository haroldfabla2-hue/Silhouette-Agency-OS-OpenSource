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
    enabled: boolean;
    allowEvolution: boolean;
    enableNarrative: boolean;
    enableIntrospection: boolean;
}

/** Proactive task name -> the autonomy flag that enables it. */
export const PROACTIVE_TASK_FLAGS: Readonly<Record<string, keyof AutonomyFlags>> = Object.freeze({
    Heartbeat: 'enabled',
    Curiosity: 'enabled',
    Dreamer: 'enabled',
    Narrator: 'enableNarrative',
    Evolution_Goals: 'allowEvolution',
    Tool_Evolution: 'allowEvolution',
    SelfDev: 'allowEvolution',
});

/**
 * True when the task may run under the given flags. Tasks not listed in
 * PROACTIVE_TASK_FLAGS are maintenance work and are always allowed.
 */
export function isTaskAllowedByAutonomy(taskName: string, flags: AutonomyFlags): boolean {
    const flag = PROACTIVE_TASK_FLAGS[taskName];
    if (!flag) return true;
    return !!flags[flag];
}

/**
 * Auto-applying a generated fix IS evolution (it mutates how the system
 * behaves), so it requires allowEvolution - even when it happens inside a
 * maintenance task (Self-Healing) that itself always runs. Ingestion and
 * analysis stay maintenance; the mutation does not.
 */
export function isAutoApplyAllowed(flags: AutonomyFlags): boolean {
    return !!flags.allowEvolution;
}
