/**
 * Autonomy task policy - config flags actually govern proactive daemon tasks.
 */
import { describe, it, expect } from 'vitest';
import { isTaskAllowedByAutonomy, PROACTIVE_TASK_FLAGS } from '../../services/daemon/autonomyPolicy';

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
