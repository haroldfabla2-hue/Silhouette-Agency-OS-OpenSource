import { describe, it, expect } from 'vitest';
import { checkScope, checkShrink, MAX_DELETE_RATIO } from '../../services/selfdev/gates';

// FASE1 PR-D: cycle 4 (2026-10-14) proved VERIFIED != correct - the planner
// gutted selfdev.routes.ts (60 lines -> 24, cycles API destroyed) and the
// narrow acceptance test passed twice. These gates make that shape FAILED
// before it touches disk, and the typecheck/route-smoke gates catch it after.

describe('scope gate', () => {
    const scope = ['server/routes/v1/selfdev.routes.ts'];
    it('passes ops inside the declared scope', () => {
        expect(checkScope([{ path: scope[0], content: 'x' }], scope)).toBeNull();
        // a file nested inside a scoped directory is in scope (matches attempt() semantics)
        expect(checkScope([{ path: 'server/routes/v1/x.ts', content: 'x' }], ['server/routes'])).toBeNull();
        // sibling-prefix spoof is NOT in scope
        expect(checkScope([{ path: 'server/routes-evil/x.ts', content: 'x' }], ['server/routes'])?.gate).toBe('scope');
    });
    it('blocks ops outside the declared scope', () => {
        const f = checkScope([{ path: 'services/other.ts', content: 'x' }], scope);
        expect(f?.gate).toBe('scope');
        expect(f?.detail).toContain('services/other.ts');
    });
});

describe('shrink gate', () => {
    const big = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    it('passes small edits', () => {
        const edited = big.split('\n').slice(0, 55).join('\n');
        expect(checkShrink([{ path: 'a.ts', content: edited }], () => big)).toBeNull();
    });
    it('blocks gutting a file (the cycle-4 shape)', () => {
        const gutted = Array.from({ length: 24 }, (_, i) => `new ${i}`).join('\n');
        const f = checkShrink([{ path: 'a.ts', content: gutted }], () => big);
        expect(f?.gate).toBe('shrink');
        expect(f?.detail).toContain('60 -> 24');
    });
    it('ignores new files and tiny files', () => {
        expect(checkShrink([{ path: 'new.ts', content: 'x' }], () => null)).toBeNull();
        expect(checkShrink([{ path: 'tiny.ts', content: 'x' }], () => 'a\nb')).toBeNull();
    });
    it('honors a stricter custom ratio', () => {
        const edited = big.split('\n').slice(0, 40).join('\n');
        expect(checkShrink([{ path: 'a.ts', content: edited }], () => big, 0.2)?.gate).toBe('shrink');
        expect(MAX_DELETE_RATIO).toBe(0.5);
    });
});
