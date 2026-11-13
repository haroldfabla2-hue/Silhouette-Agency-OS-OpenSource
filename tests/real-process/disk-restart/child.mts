// Proposed real disk recovery across two child processes. NOT EXECUTED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MemoryTier, type MemoryNode } from '../../../types.ts';
import type { SnapshotReceipt } from '../../../services/continuumMemory.ts';
interface WriteProof { node: MemoryNode; receipt: SnapshotReceipt; pid: number }
const phase = process.env.FIXTURE_PHASE;
const marker = 'initial-owner-real-disk-restart-unique-fixture';
assert.ok(phase === 'write' || phase === 'read');
assert.equal(await fs.readFile('FIXTURE_ONLY', 'utf8'), 'DISK_RESTART_ONLY');
assert.equal(process.env.REDIS_URL, undefined);
assert.equal(process.env.USE_REDIS, undefined);
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(path.resolve(process.env.SILHOUETTE_DB_PATH!), path.resolve('db/fixture.sqlite'));
let prior: WriteProof | undefined;
if (phase === 'read') {
    // Before ANY app import can hydrate/store a concept or rewrite snapshot.
    prior = JSON.parse(await fs.readFile('write-proof.json', 'utf8')) as WriteProof;
    assert.equal(prior.receipt.disk, 'CONFIRMED');
    const bytes = await fs.readFile('data/memory_snapshot.json');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), prior.receipt.checksum);
    assert.notEqual(prior.pid, process.pid);
    console.log('DISK_RESTART_FIXTURE:' + JSON.stringify({ event: 'PREIMPORT_CHECKSUM', phase, checksum: prior.receipt.checksum }));
}
// Literal dynamic imports retain actual module types. No any contract/stub.
const { sqliteService } = await import('../../../services/sqliteService.ts');
try {
    if (phase === 'write') sqliteService.setConfig('active_goals', []);
    assert.deepEqual(sqliteService.getConfig('active_goals'), []);
    // Read phase never reseeds DB, snapshot or proof.
    const { continuum } = await import('../../../services/continuumMemory.ts');
    const report = await continuum.readyCore();
    assert.equal(report.outcome, 'COMPLETE');
    assert.equal(report.source, 'DISK');
    assert.equal(report.snapshotLoaded, true);
    assert.equal(report.journalVerified, 0);
    assert.deepEqual(report.unresolved, []);
    assert.deepEqual(report.errors, []);
    const { introspection } = await import('../../../services/introspectionEngine.ts');
    const initial = await introspection.readyInitial();
    assert.equal(initial.concept.state, 'COMPLETE');
    assert.equal(initial.concept.coreOutcome, 'COMPLETE');
    assert.equal(initial.goals.state, 'COMPLETE');
    if (phase === 'write') {
        assert.equal(continuum.getVolatileState().filter(n => n.content === marker).length, 0);
        // Explicit direct-store cut. Normal HTTP/ingestion path is NOT tested.
        await continuum.store(marker, MemoryTier.WORKING, ['fixture-only-restart'], true);
    }
    const found = continuum.getVolatileState().filter(n => n.content === marker);
    assert.equal(found.length, 1);
    const node = found[0];
    assert.equal(node.tier, MemoryTier.WORKING);
    assert.ok(node.tags.includes('fixture-only-restart'));
    let receipt: SnapshotReceipt;
    if (phase === 'write') {
        receipt = await continuum.forceSave();
        const bytes = await fs.readFile('data/memory_snapshot.json');
        assert.equal(receipt.disk, 'CONFIRMED');
        assert.equal(receipt.checksum, createHash('sha256').update(bytes).digest('hex'));
        assert.equal(continuum.getSnapshotOperations().length, 0);
        const proof: WriteProof = { node, receipt, pid: process.pid };
        await fs.writeFile('write-proof.json', JSON.stringify(proof));
    } else {
        assert.ok(prior);
        receipt = prior.receipt; // Preserve ALL redis status/error fields, never assert Redis durability.
        assert.equal(node.id, prior.node.id);
        assert.equal(node.content, prior.node.content);
        assert.equal(node.originalContent, prior.node.originalContent);
        assert.equal(node.timestamp, prior.node.timestamp);
        assert.deepEqual(node.tags, prior.node.tags);
        assert.equal(node.tier, prior.node.tier);
        const snapshot = JSON.parse(await fs.readFile('data/memory_snapshot.json', 'utf8')) as { working: MemoryNode[] };
        assert.equal(snapshot.working.filter(n => n.id === node.id).length, 1);
    }
    console.log('DISK_RESTART_FIXTURE:' + JSON.stringify({ event: 'ASSERTIONS_DONE', phase, pid: process.pid, nodeId: node.id, report, initial, receipt }));
} finally {
    sqliteService.close(); // May swallow close error in current implementation.
    console.log('DISK_RESTART_FIXTURE:' + JSON.stringify({ event: 'BODY_DONE', phase }));
}
// BODY_DONE alone is not close proof. Supervisor requires natural exit/reap/groupESRCH/EOF.
