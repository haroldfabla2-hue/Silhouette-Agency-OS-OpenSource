// Actual services only. Run in a disposable filesystem/network namespace,
// with provider transport OFF and no production stores. Fixture inputs are
// not generated provider responses and do not prove positive research.
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const mode = process.argv[2];
const resultFile = '/tmp/result/experience-before.json';
if (mode === 'experience-write') {
    const { experienceBuffer } = await import('../../services/experienceBuffer');
    await experienceBuffer.recordFailure('fixture-durable-context | original\nsecond line', 'actual-fixture-action', 'actual-fixture-failure', 'original | lesson', 'fixture-agent');
    const original = experienceBuffer.getRecent(1, 'FAILURE')[0];
    const read = await experienceBuffer.getRelevant('fixture-durable-context', 10);
    assert.deepEqual(read.find(x => x.id === original.id), original);
    fs.writeFileSync(resultFile, JSON.stringify(original));
    console.log(JSON.stringify({ mode, original_identity_and_fields_retained: true }));
} else if (mode === 'experience-read') {
    const { experienceBuffer } = await import('../../services/experienceBuffer');
    const original = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const read = await experienceBuffer.getRelevant('fixture-durable-context', 10);
    assert.deepEqual(read.find(x => x.id === original.id), original);
    assert.equal(experienceBuffer.getRecent().length, 0, 'fresh process RAM is not a durable history claim');
    console.log(JSON.stringify({ mode, fresh_process_identity_time_and_fields_retained: true }));
} else if (mode === 'experience-learning-read') {
    const { experienceBuffer } = await import('../../services/experienceBuffer');
    const { learningLoop } = await import('../../services/learningLoop');
    const original = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.equal(experienceBuffer.getRecent().length, 0, 'new process starts with no RAM replay');
    const failures = await (learningLoop as any).getRecentFailures(experienceBuffer, 86400000);
    assert.ok(failures.some((e: any) => e.context === original.context && e.timestamp === original.timestamp
        && e.error === original.outcome && e.source === original.agentId), 'durable failure must reach actual learning selector after restart');
    console.log(JSON.stringify({ mode, fresh_process_learning_selector_retains_original_failure: true }));
} else if (mode === 'experience-window') {
    const { lancedbService } = await import('../../services/lancedbService');
    const { experienceBuffer } = await import('../../services/experienceBuffer');
    const { learningLoop } = await import('../../services/learningLoop');
    const { MemoryTier } = await import('../../types');
    const base = Date.now() - 10000;
    const records = Array.from({length:105}, (_, i) => {
        const exp = {id:`window-experience-${i}`, type:'FAILURE', context:`window-context-${i}`,
            action:'authored local fixture', outcome:'authored fixture failure', timestamp:base+i, agentId:'window-agent'};
        return {id:`window-memory-${i}`, content:`[EXPERIENCE:FAILURE] V2 ${JSON.stringify(exp)}`,
            timestamp:exp.timestamp, tier:MemoryTier.LONG, importance:0.5, tags:['EXPERIENCE','FAILURE'], accessCount:0, lastAccess:exp.timestamp};
    });
    records.push({...records[0], id:'not-an-experience', timestamp:base+9999, tags:['FAILURE'], content:'ordinary error, not an experience'});
    await lancedbService.storeMany(records);
    const selected = await experienceBuffer.getRecentDurable(100, 'FAILURE');
    assert.equal(selected.length, 100);
    assert.equal(selected[0].id, 'window-experience-104');
    assert.equal(selected[99].id, 'window-experience-5');
    const failures = await (learningLoop as any).getRecentFailures(experienceBuffer, 86400000);
    assert.equal(failures.length, 100);
    assert.equal(failures[0].context, 'window-context-104');
    await assert.rejects(experienceBuffer.getRecentDurable(101));
    await assert.rejects(experienceBuffer.getRecentDurable(NaN));
    // A canonical update can remove the selector tag. Stale prior rows must not win.
    await lancedbService.store({...records[104], tags:['EXPERIENCE','SUCCESS'],
        content:records[104].content.replace('EXPERIENCE:FAILURE', 'EXPERIENCE:SUCCESS').replace('"type":"FAILURE"', '"type":"SUCCESS"')});
    const updated = await experienceBuffer.getRecentDurable(100, 'FAILURE');
    assert.equal(updated[0].id, 'window-experience-103');
    await lancedbService.store({...records[0], id:'malformed-experience', timestamp:base+10000,
        content:'[EXPERIENCE:FAILURE] V2 {broken'});
    await assert.rejects(experienceBuffer.getRecentDurable(100, 'FAILURE'), /Invalid durable experience/);
    console.log(JSON.stringify({mode, bounded_latest_failures:100, unrelated_tags_excluded:true,
        canonical_update_respected:true, malformed_experience_not_empty_success:true}));
} else if (mode === 'experience-rejected') {
    const { experienceBuffer } = await import('../../services/experienceBuffer');
    await assert.rejects(experienceBuffer.recordFailure('fixture-rejected', 'fixture-action', 'memory that is identical to itself'), /persistence unverified/);
    assert.equal(experienceBuffer.getRecent().length, 0);
    console.log(JSON.stringify({ mode, actual_store_rejection_propagated: true, phantom_buffer_count: 0 }));
} else if (mode === 'experience-legacy') {
    const { continuum } = await import('../../services/continuumMemory');
    const { MemoryTier } = await import('../../types');
    const { experienceBuffer } = await import('../../services/experienceBuffer');
    const content = '[EXPERIENCE:FAILURE] Context: fixture-legacy-context | Action: original action | Outcome: original failure | Lesson: original lesson';
    await continuum.store(content, MemoryTier.LONG, ['EXPERIENCE', 'fixture-legacy', 'agent:legacy-agent']);
    const node = await continuum.getLatestObservation('fixture-legacy');
    assert.ok(node);
    const read = await experienceBuffer.getRelevant('fixture-legacy-context', 10);
    const legacy = read.find(e => e.context === 'fixture-legacy-context');
    assert.equal(legacy?.id, node.id);
    assert.equal(legacy?.timestamp, node.timestamp);
    assert.equal(legacy?.identityProvenance, 'legacy-memory-node');
    assert.equal(legacy?.agentId, 'legacy-agent');
    console.log(JSON.stringify({ mode, actual_memory_provenance_not_fabricated_original: true }));
} else if (mode === 'learning-outcomes') {
    const { learningLoop } = await import('../../services/learningLoop');
    const base = { failureCount: 5, pattern: 'fixture input, not LLM output', rootCause: 'fixture', suggestedFix: 'fixture proposal only', confidence: 0.95, autoApplicable: true };
    const before = learningLoop.getStats().autoApplied;
    assert.deepEqual(await learningLoop.routeInsight({ ...base, context: 'fixture-unhandled-context' }), { stage: 'UNHANDLED', applied: false });
    const proposed = await learningLoop.routeInsight({ ...base, context: 'prompt-fixture' });
    assert.equal(proposed.stage, 'PROPOSAL_RECORDED');
    assert.ok(proposed.proposalMemoryId);
    assert.equal(proposed.applied, false);
    const retry = await learningLoop.routeInsight({ ...base, context: 'prompt-fixture' });
    assert.equal(retry.proposalMemoryId, proposed.proposalMemoryId);
    const rejected = await learningLoop.routeInsight({ ...base, context: 'prompt-fixture', suggestedFix: 'memory that is identical to itself' });
    assert.equal(rejected.stage, 'FAILED', 'a void memory rejection is not successful persistence');
    assert.equal(await learningLoop.applyInsight({ ...base, context: 'fixture-unhandled-context' }), false);
    assert.equal(learningLoop.getStats().autoApplied, before);
    console.log(JSON.stringify({ mode, unhandled_not_applied: true, proposal_readback_verified: true, rejected_store_not_success: true, auto_applied_delta: 0 }));
} else if (mode === 'gap-write') {
    const { curiosity } = await import('../../services/curiosityService');
    // Immediate import -> mutation exercises the restore barrier, no sleeps.
    await Promise.all([curiosity.addGap('fixture-retained-a', 'first original question'), curiosity.addGap('fixture-retained-b', 'second original question')]);
    const { systemBus } = await import('../../services/systemBus');
    const { SystemProtocol } = await import('../../types');
    systemBus.emit(SystemProtocol.MEMORY_CREATED, { content: 'FixtureEventTopic information' }, 'fixture');
    systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: ['FixtureThoughtTopic information'] }, 'fixture');
    await curiosity.waitForPersistence();
    assert.equal((curiosity as any).topicFrequency.get('fixtureeventtopic').count, 1);
    assert.equal((curiosity as any).topicFrequency.get('fixturethoughttopic').count, 1);
    assert.equal(curiosity.getGaps().filter(g => g.topic.startsWith('fixture-retained-')).length, 2);
    console.log(JSON.stringify({ mode, gaps: 2, actual_bus_topics: 2 }));
} else if (mode === 'gap-read') {
    const { curiosity } = await import('../../services/curiosityService');
    await curiosity.waitForPersistence();
    assert.equal(curiosity.getGaps().filter(g => g.topic.startsWith('fixture-retained-')).length, 2);
    assert.equal((curiosity as any).topicFrequency.get('fixtureeventtopic').count, 1);
    assert.equal((curiosity as any).topicFrequency.get('fixturethoughttopic').count, 1);
    console.log(JSON.stringify({ mode, fresh_process_gaps: 2, actual_bus_topics: 2 }));
} else if (mode === 'discovery-readback') {
    const { curiosity } = await import('../../services/curiosityService');
    await curiosity.waitForPersistence();
    await (curiosity as any).storeDiscovery('fixture', 'fixture question', 'fixture authored answer, not provider output');
    await assert.rejects((curiosity as any).storeDiscovery('fixture', 'fixture question', 'memory that is identical to itself'), /persistence unverified/);
    console.log(JSON.stringify({ mode, canonical_readback: true, actual_rejected_store_detected: true, research_or_synthesis_proven: false }));
} else if (mode === 'gap-corrupt') {
    const file = 'data/curiosity_gaps.json';
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, '{broken snapshot');
    const broken = fs.readFileSync(file);
    try {
        const { curiosity } = await import('../../services/curiosityService');
        await assert.rejects(curiosity.addGap('must-not-overwrite', 'fixture'), SyntaxError);
        assert.deepEqual(fs.readFileSync(file), broken);
    } finally { fs.writeFileSync(file, original); }
    console.log(JSON.stringify({ mode, corrupt_original_preserved: true, mutation_refused: true }));
} else {
    throw new Error('Explicit continuity probe mode required');
}
process.exit(0);
