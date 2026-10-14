import { describe, it, expect } from 'vitest';

// Wave-2 P0 live smoke: written by a self-dev cycle inside the isolated
// selfwork clone, verified twice in-clone, PR created via operator approval.
const double = (n: number) => n * 2;

describe('selfdev live smoke', () => {
    it('doubles', () => { expect(double(21)).toBe(42); });
});
