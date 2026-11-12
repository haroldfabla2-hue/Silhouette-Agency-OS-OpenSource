// Proposed focused native-SQLite fixture, NOT RUN. Run one case per fresh child.
import rawAssert from 'node:assert/strict';
let assertionCount = 0;
const assert = new Proxy(rawAssert, {
    get(target, key) {
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? (...args: any[]) => { assertionCount++; return value(...args); } : value;
    }
});
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Observation } from '../../../types';
import type { IntrospectionEngine } from '../../../services/introspectionEngine';
// Compile against the actual public API, not a stub/interface substitute.
type ObserveAPI = IntrospectionEngine['observe'];
const requireObserveAPI = (observe: ObserveAPI): (() => Promise<Observation>) => observe;
const root = process.env.FIXTURE_CANDIDATE_ROOT!;
const source = (name: string) => pathToFileURL(path.join(root, name)).href;
const caseName = process.env.FIXTURE_CASE!;
assert.ok(['sqlite-empty', 'sqlite-json-corrupt'].includes(caseName));
assert.equal(await fs.readFile('FIXTURE_ONLY', 'utf8'), 'INTROSPECTION_INITIAL_ONLY');
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.REDIS_URL, undefined);
assert.equal(process.env.USE_REDIS, undefined);
assert.equal(path.resolve(process.env.SILHOUETTE_DB_PATH!), path.resolve('db/fixture.sqlite'));
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/memory_snapshot.json', '{broken');
// Explicit known app-SQLite ownership: this fixture imports the singleton FIRST,
// writes fixture rows and closes this exact opened handle after both owners settle.
// It does not import random services in finally hoping to close guessed owners.
const { sqliteService } = await import(source('services/sqliteService.ts'));
try {
    if (caseName === 'sqlite-empty') sqliteService.setConfig('active_goals', []);
    else sqliteService.db.prepare('INSERT INTO system_config(key,value,updated_at) VALUES(?,?,?)').run('active_goals', '{invalid', 1);
    const { introspection } = await import(source('services/introspectionEngine.ts'));
    const realObserve = requireObserveAPI(introspection.observe.bind(introspection));
    assert.equal(typeof realObserve, 'function'); // API real, no replacement
    const owners = introspection.getInitialOwners();
    await assert.rejects(owners.concept);
    if (caseName === 'sqlite-empty') await owners.goals;
    else await assert.rejects(owners.goals); // actual native query JSON.parse error
    const statuses = await introspection.readyInitial();
    assert.equal(statuses.concept.state, 'FAILED');
    assert.equal(statuses.concept.coreOutcome, 'FAILED');
    assert.equal(statuses.goals.state, caseName === 'sqlite-empty' ? 'COMPLETE' : 'FAILED');
    assert.equal(statuses.goals.coreOutcome, undefined, 'SQLite-only path did not await core');
    assert.ok(statuses.concept.error);
    if (caseName === 'sqlite-json-corrupt') assert.ok(statuses.goals.error);
    assert.equal(await fs.readFile('data/memory_snapshot.json', 'utf8'), '{broken');
    // Later ledger/APIs were intentionally deferred. No sync ID is asserted as a
    // persistence receipt; no actual observe() graph/visual side effects invoked.
    console.log('INITIAL_ONLY_FIXTURE:' + JSON.stringify({ caseName, event: 'ASSERTIONS_DONE', assertionCount, statuses }));
} finally {
    sqliteService.close(); // only known explicitly opened app handle
    console.log('INITIAL_ONLY_FIXTURE:' + JSON.stringify({ caseName, event: 'BODY_DONE' }));
}
// No process.exit0, Redis/systemBus shutdown, timer clears or assumed graph drain.
// Other actual import owners, if any, must finish naturally or close-budget FAIL.
