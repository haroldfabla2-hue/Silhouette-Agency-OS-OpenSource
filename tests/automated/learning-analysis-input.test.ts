/** Authored pure canonicalization examples, not model or repair evidence. */
import { expect, it } from 'vitest';
import { canonicalLearningAnalysisInput } from '../../services/selfdev/learningAnalysisInput';
it('constructs exact canonical values independently of caller insertion order', () => {
    const input = { source: 'SYSTEM', error: 'authored error', context: 'continuum-promote', timestamp: 12,
        action: 'Observe', incident: { firstSeen: 12, source: 'continuum-promote', id: 'episode' }, id: 'incident:episode' };
    const result = canonicalLearningAnalysisInput('continuum-promote', [input]);
    expect(JSON.parse(result)).toEqual({ version: 1, context: 'continuum-promote', failures: [{ id: 'incident:episode',
        incident: { id: 'episode', source: 'continuum-promote', firstSeen: 12 }, timestamp: 12, context: 'continuum-promote',
        action: 'Observe', result: 'FAILURE', error: 'authored error', source: 'SYSTEM' }] });
    expect(canonicalLearningAnalysisInput('continuum-promote', [{ ...input, incident: { id: 'episode', source: 'continuum-promote', firstSeen: 12 } }])).toBe(result);
    expect(() => canonicalLearningAnalysisInput('continuum-promote', [input, input])).toThrow(/Distinct/);
    expect(() => canonicalLearningAnalysisInput('other', [input])).toThrow(/Invalid/);
});
