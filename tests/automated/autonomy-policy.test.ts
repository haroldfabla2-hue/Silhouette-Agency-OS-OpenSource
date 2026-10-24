/**
 * Autonomy task policy - config flags actually govern proactive daemon tasks.
 */
import { describe, it, expect } from 'vitest';
import { isTaskAllowedByAutonomy, isAutoApplyAllowed, PROACTIVE_TASK_FLAGS } from '../../services/daemon/autonomyPolicy';

const OFF = { enabled: false, allowEvolution: false, enableNarrative: false, enableIntrospection: false };
const ON = { enabled: true, allowEvolution: true, enableNarrative: true, enableIntrospection: true };

describe('isTaskAllowedByAutonomy', () => {
    it('disables proactive tasks when autonomy.enabled=false', () => {
        for (const t of ['Heartbeat', 'Curiosity', 'Dreamer']) {
            expect(isTaskAllowedByAutonomy(t, OFF)).toBe(false);
            expect(isTaskAllowedByAutonomy(t, { ...OFF, enabled: true })).toBe(true);
        }
    });

    it('gates evolution tasks behind allowEvolution', () => {
        for (const t of ['Evolution_Goals', 'Tool_Evolution', 'SelfDev']) {
            expect(isTaskAllowedByAutonomy(t, { ...ON, allowEvolution: false })).toBe(false);
            expect(isTaskAllowedByAutonomy(t, ON)).toBe(true);
        }
    });

    it('gates introspection behind enableIntrospection', () => {
        expect(isTaskAllowedByAutonomy('Introspection', { ...ON, enableIntrospection: false })).toBe(false);
        expect(isTaskAllowedByAutonomy('Introspection', ON)).toBe(true);
        expect(isTaskAllowedByAutonomy('Introspection', OFF)).toBe(false);
    });

    it('gates the narrator behind enableNarrative', () => {
        expect(isTaskAllowedByAutonomy('Narrator', { ...ON, enableNarrative: false })).toBe(false);
        expect(isTaskAllowedByAutonomy('Narrator', ON)).toBe(true);
    });

    it('maintenance tasks always run (not autonomy)', () => {
        for (const t of ['Self_Healing', 'Janitor']) {
            expect(isTaskAllowedByAutonomy(t, OFF)).toBe(true);
            expect(isTaskAllowedByAutonomy(t, ON)).toBe(true);
        }
    });

    it('every mapped task maps to a real flag', () => {
        for (const flag of Object.values(PROACTIVE_TASK_FLAGS)) {
            expect(['enabled', 'allowEvolution', 'enableNarrative', 'enableIntrospection']).toContain(flag);
        }
    });
});

describe('isAutoApplyAllowed (self-healing auto-apply is evolution)', () => {
    it('auto-apply of insights requires allowEvolution, even inside maintenance tasks', () => {
        expect(isAutoApplyAllowed(OFF)).toBe(false);
        expect(isAutoApplyAllowed({ ...ON, allowEvolution: false })).toBe(false);
        expect(isAutoApplyAllowed(ON)).toBe(true);
    });

    it('autonomy.enabled alone does not authorize auto-apply', () => {
        expect(isAutoApplyAllowed({ ...OFF, enabled: true })).toBe(false);
    });

    it('MASTER OFF wins: allowEvolution=true with enabled=false does NOT auto-apply', () => {
        expect(isAutoApplyAllowed({ ...OFF, enabled: false, allowEvolution: true })).toBe(false);
    });
});

describe('master switch precedence over sub-flags', () => {
    it('enabled=false disables evolution tasks even with allowEvolution=true', () => {
        for (const t of ['Evolution_Goals', 'Tool_Evolution', 'SelfDev']) {
            expect(isTaskAllowedByAutonomy(t, { enabled: false, allowEvolution: true, enableNarrative: true, enableIntrospection: true })).toBe(false);
        }
    });

    it('enabled=false disables the narrator even with enableNarrative=true', () => {
        expect(isTaskAllowedByAutonomy('Narrator', { enabled: false, allowEvolution: false, enableNarrative: true, enableIntrospection: false })).toBe(false);
    });

    it('sub-flags operate only within enabled=true', () => {
        expect(isTaskAllowedByAutonomy('Narrator', { ...ON, enableNarrative: true })).toBe(true);
        expect(isTaskAllowedByAutonomy('Tool_Evolution', { ...ON, allowEvolution: true })).toBe(true);
        expect(isTaskAllowedByAutonomy('Tool_Evolution', { ...ON, allowEvolution: false })).toBe(false);
    });
});
