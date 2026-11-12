// PREPARED ONLY. No runtime/model operation, mocks, providers, engines or loops.
// The reviewed external supervisor must observe syscalls and require no attempted
// network, writes or unexpected process startup. This script alone is NOT a sandbox.
import assert from 'node:assert/strict';
import { readdir, readFile, readlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

async function inventory(root: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const item of await readdir(root, { withFileTypes: true })) {
        const name = path.join(root, item.name);
        const stat = await lstat(name);
        if (item.isSymbolicLink()) result[name] = `symlink:${await readlink(name)}`;
        else if (item.isDirectory()) {
            result[name] = `directory:${stat.mode}`;
            Object.assign(result, await inventory(name));
        } else if (item.isFile()) result[name] = `file:${stat.mode}:${createHash('sha256').update(await readFile(name)).digest('hex')}`;
        else result[name] = `special:${stat.mode}`;
    }
    return result;
}
assert.equal(process.env.VITEST, undefined);
assert.equal(process.env.REDIS_URL, undefined);
assert.equal(process.env.USE_REDIS, undefined);
const roots = [process.cwd(), process.env.HOME!, process.env.TMPDIR!];
assert.equal(new Set(roots).size, 3, 'Need distinct fresh public roots');
assert.ok(roots.every(p => path.isAbsolute(p)));
const before = await Promise.all(roots.map(inventory));
const beforeTimers = process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;
// Concurrent real imports exercise ESM single instantiation, without calling an
// effectful synthesis/embedding operation. Later repeat import checks cache identity.
const [localA, localB, dreamA, dreamB] = await Promise.all([
    import('../../services/localEmbeddingService'), import('../../services/localEmbeddingService'),
    import('../../services/dreamerService'), import('../../services/dreamerService')
]);
assert.strictEqual(localA.localEmbeddingService, localB.localEmbeddingService);
assert.strictEqual(dreamA.dreamer, dreamB.dreamer);
assert.strictEqual((await import('../../services/dreamerService')).dreamer, dreamA.dreamer);
assert.strictEqual((await import('../../services/localEmbeddingService')).localEmbeddingService, localA.localEmbeddingService);
await new Promise(resolve => setTimeout(resolve, 500));
assert.deepEqual(await Promise.all(roots.map(inventory)), before, 'Import changed public root inventory');
assert.equal(process.getActiveResourcesInfo().filter(x => x === 'Timeout').length, beforeTimers);
assert.equal((localA.localEmbeddingService as any).initPromise, null);
assert.equal((localA.localEmbeddingService as any).extractor, null);
assert.equal((dreamA.dreamer as any).dreamInterval, null);
console.log('IMPORT_LIFECYCLE_PUBLIC_FIXTURE_PASS');
