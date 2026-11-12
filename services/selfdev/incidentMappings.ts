/** Product-declared repair domains. Neither planner text nor confidence may add scope. */
const mappings: Readonly<Record<string, { readonly scope: readonly string[]; readonly acceptance: string }>> = Object.freeze({
    'continuum-promote': Object.freeze({ scope: Object.freeze(['services/continuumMemory.ts', 'services/memoryTransitions.ts']), acceptance: 'tests/automated/deep-memory-identity.test.ts' }),
    'continuum-embeddings': Object.freeze({ scope: Object.freeze(['services/continuumMemory.ts']), acceptance: 'tests/automated/deep-memory-identity.test.ts' })
});
export function memoryRepairMapping(source: string): { scope: string[]; acceptance: string } | undefined {
    const mapping = Object.hasOwn(mappings, source) ? mappings[source] : undefined;
    return mapping ? { scope: [...mapping.scope], acceptance: mapping.acceptance } : undefined;
}
