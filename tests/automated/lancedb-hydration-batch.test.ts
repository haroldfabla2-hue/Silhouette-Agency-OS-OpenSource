import { afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as lance from '@lancedb/lancedb';
import { LanceDbService } from '../../services/lancedbService';
import { MemoryTier, type MemoryNode } from '../../types';

const identity = { model: 'PUBLIC_BATCH_FIXTURE', version: '1', dimension: 3 };
const dirs: string[] = [];
afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
    const dir = await mkdtemp(path.join(tmpdir(), 'canonical-batch-real-'));
    dirs.push(dir);
    return { dir, service: new LanceDbService(dir) };
}
function node(id: string, content = 'Public fixture'): MemoryNode {
    return { id, content, embeddingIdentity: identity, ownerId: 'PUBLIC', tags: ['PUBLIC'],
        tier: MemoryTier.DEEP, timestamp: 1, importance: 0.1, accessCount: 0, lastAccess: 1 };
}

describe('Lance canonical hydration on real storage (no service doubles)', () => {
    it('returns 50 identified memories in cosine order', async () => {
        const { service } = await fixture();
        for (let i = 0; i < 50; i++) await service.store(node(`public-${i}`), [1, i / 50, 0]);
        const results = await service.search([1, 0, 0], 50, undefined, identity);
        expect(results.map(n => n.id)).toEqual(Array.from({ length: 50 }, (_, i) => `public-${i}`));
        // Actual retrieval, not a claim of measured internal query-call count.
    });
    it('rejects actual duplicate canonical IDs', async () => {
        const { dir, service } = await fixture();
        await service.store(node('public-duplicate'), [1, 0, 0]);
        const conn = await lance.connect(dir);
        const table = await conn.openTable('memory_records_v2');
        const rows = await table.query().toArray();
        await table.add(rows.map(row => ({ ...row, tags: Array.from(row.tags) })));
        await expect(service.search([1, 0, 0], 1, undefined, identity)).rejects.toThrow('Duplicate memory ID');
    });
    it('returns empty when the projection identity is absent', async () => {
        const { service } = await fixture();
        expect(await service.search([1, 0, 0], 5, undefined, identity)).toEqual([]);
    });
    it('passes paged stale identity/content/owner, malformed and scope regression', () => {
        const parent = path.join(tmpdir(), 'canonical-subprocess-' + crypto.randomUUID());
        dirs.push(parent);
        const output = execFileSync(process.execPath, ['--import', 'tsx',
            path.resolve('tests/integration/canonical-projection-identity.real.ts')], {
            env: { ...process.env, CANONICAL_IDENTITY_TEST_DIR: parent, VECTOR_ENGINE: 'scan',
                LANCEDB_OPTIMIZE_INTERVAL_MINUTES: '0' }, encoding: 'utf8', timeout: 25000,
        });
        expect(output).toContain('CANONICAL_PROJECTION_IDENTITY_REAL_PASS');
    });
});
