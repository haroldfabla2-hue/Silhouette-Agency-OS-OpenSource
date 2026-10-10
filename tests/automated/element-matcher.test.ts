import { describe, it, expect } from 'vitest';
import { matchInstruction } from '../../services/browser/elementMatcher';

const el = (id: number, tag: string, text: string) => ({ id, tag, text });

describe('element matcher (regressions)', () => {
    const els = [el(1, 'button', 'Continue'), el(2, 'button', 'Cancel'), el(3, 'a', 'Help center')];
    it('"click continue" finds the Continue button (the old double-escaped regex never split words)', () => {
        expect(matchInstruction('click continue', els).element?.id).toBe(1);
    });
    it('numbers inside text are not treated as element ids', () => {
        expect(matchInstruction('type 12345 in the cancel field', [el(12345, 'input', 'x'), ...els]).element?.id).toBe(2);
        expect(matchInstruction('click #3', els).element?.id).toBe(3);
        expect(matchInstruction('click element 2', els).element?.id).toBe(2);
    });
    it('ties are reported as ambiguous instead of picking the first', () => {
        const r = matchInstruction('click delete', [el(1, 'button', 'Delete'), el(2, 'button', 'Delete')]);
        expect(r.element).toBeNull();
        expect(r.ambiguous).toBe(true);
        expect(r.candidates.map(c => c.id)).toEqual([1, 2]);
    });
    it('no match returns null, not ambiguous', () => {
        const r = matchInstruction('click zebra', els);
        expect(r.element).toBeNull();
        expect(r.ambiguous).toBe(false);
    });
});

describe('clearObstructions never accepts consent (regression)', () => {
    it('selector list has no accept/agree buttons', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(new URL('../../services/browser/visualBrowserEngine.ts', import.meta.url), 'utf8');
        const a = src.indexOf('dismissButtonSelectors = [');
        const list = src.slice(a, src.indexOf('];', a));
        expect(list).not.toMatch(/accept|agree|consent/i);
        expect(list).toMatch(/close/);
    });
});
