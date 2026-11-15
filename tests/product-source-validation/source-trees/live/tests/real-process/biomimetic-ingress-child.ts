// Run only in a disposable filesystem and network namespace with providers
// OFF. No production database/workspace, LLM or synthetic service response.
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';

const mode = process.argv[2];
if (mode === 'learning') {
    const { experienceBuffer } = await import('../../services/experienceBuffer');
    const { learningLoop } = await import('../../services/learningLoop');
    await experienceBuffer.recordFailure('fixture-tool', 'fixture-action', 'fixture-error');
    await experienceBuffer.recordSuccess('fixture-tool', 'fixture-action', 'fixture-success');
    const selected = await (learningLoop as any).getRecentFailures(experienceBuffer, 86400000);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].error, 'fixture-error');
    assert.equal(selected[0].result, 'FAILURE');
    await assert.rejects((learningLoop as any).getRecentFailures(experienceBuffer, NaN));
    console.log(JSON.stringify({ mode, actual_recorded_failures_selected: selected.length,
        success_excluded: true, provider_generation_executed: false }));
} else if (mode === 'narrative') {
    const { narrative } = await import('../../services/narrativeService');
    const { continuum } = await import('../../services/continuumMemory');
    const prefix = 'FIXTURE introspection source event repeated prefix longer than sixty characters ';
    for (const suffix of ['outcome-alpha', 'outcome-beta']) {
        await (narrative as any).queueOrEmitThought('CONSCIOUS', prefix + suffix, 0.9, { source: 'fixture-observer' });
    }
    const found = await continuum.search('FIXTURE introspection source event');
    assert.equal(found.length, 2, 'original events must reach memory before provider work');
    assert.equal((narrative as any).narrationQueue.length, 2, 'shared prefix is not identical content');
    assert.ok(found.every(n => n.tags.includes('source:SYSTEM') && n.tags.includes('RAW_SYSTEM_EVENT')));
    assert.ok(found.every(n => !n.tags.includes('source:USER_SAID') && !n.tags.includes('source:INTROSPECTION')));
    console.log(JSON.stringify({ mode, original_events_remembered: found.length,
        narration_queued: 2, raw_system_provenance: true, provider_generation_executed: false }));
} else if (mode === 'dream-empty') {
    const { DreamerService } = await import('../../services/dreamerService');
    const { readDreamState, loadDreamTriggerConfig } = await import('../../services/dream/dreamTriggers');
    const { continuum } = await import('../../services/continuumMemory');
    const all = await continuum.getAllNodes();
    assert.equal(Object.values(all).flat().length, 0, 'empty disposable store required');
    const dreamer = new DreamerService();
    await dreamer.attemptDream();
    const state = readDreamState(loadDreamTriggerConfig().statePath);
    assert.equal(state.cycles, 0, 'empty attempt must not claim a completed dream');
    console.log(JSON.stringify({ mode, completed_cycles: state.cycles, provider_generation_executed: false }));
} else {
    throw new Error('Explicit learning, narrative or dream-empty probe mode required');
}
process.exit(0);
