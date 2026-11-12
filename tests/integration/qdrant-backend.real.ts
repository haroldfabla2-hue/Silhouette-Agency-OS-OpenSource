import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VectorMemoryService } from '../../services/vectorMemoryService.ts';
const base = process.env.QDRANT_CONSUMER_TEST_URL;
assert.match(base || '', /^http:\/\/127\.0\.0\.1:\d+$/);
const collectionName = `test_backend_${process.pid}`;
const tests: string[] = [];
function check(name: string, value: unknown) { assert.ok(value, name); tests.push(name); }
async function api(suffix: string, method = 'GET', body?: any) {
    const r = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', 'Connection': 'close' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
}
(async () => {
    const options = { url: base, collectionName, enabled: async () => true };
    const backend = new VectorMemoryService(options);
    const vector = Array(768).fill(0); vector[0] = 1;
    check('health_missing_down', (await backend.getHealth()).status === 'down');
    check('health_does_not_provision', (await api('/collections/' + collectionName)).status === 404);
    check('connect_missing_explicit', (await backend.connect()).state === 'unavailable');
    await assert.rejects(() => backend.storeMemory('PUBLIC', vector, { content: 'Public' })); tests.push('write_missing_rejected');
    await api('/collections/' + collectionName, 'PUT', { vectors: { size: 768, distance: 'Cosine' }, wal_config: { wal_capacity_mb: 1 } });
    check('same_instance_reconnects', (await backend.connect()).state === 'ready');
    await backend.storeMemory('PUBLIC_NON_UUID', vector, { content: 'Public fixture', tags: ['INTUITION'] });
    check('nonuuid_roundtrip', (await backend.searchMemory(vector, 10)).some(p => p.id === 'PUBLIC_NON_UUID'));
    check('tag_filter_and_score', (await backend.searchMemory(vector, 1, { tags: 'INTUITION' }))[0]?.score > 0.99);
    check('band_excludes_too_close', (await backend.searchDistantMemories(vector, 0.3, 0.7)).length === 0);
    await assert.rejects(() => backend.storeMemory('PUBLIC_INVALID', [1, 0], { content: 'Public invalid vector' })); tests.push('wrong_dimension_rejected');
    await assert.rejects(() => backend.storeMemory('PUBLIC_EMPTY', vector, { content: '' })); tests.push('empty_content_rejected');
    await backend.storeMemory('PUBLIC_BRAND', vector, { id: 'PUBLIC_BRAND', content: 'Public brand', manifesto: { toneOfVoice: ['calm'] }, designSystem: { typography: { usageRules: 'public' }, logoRules: { clearance: 'public' } } });
    check('legacy_brand_rules', (await backend.queryBrandRules('PUBLIC_BRAND', 'public')).includes('calm'));
    check('legacy_brand_payload_update', await backend.updateManifesto('PUBLIC_BRAND', 'Public feedback'));
    check('legacy_brand_payload_readback', (await backend.getBrandTwin('PUBLIC_BRAND'))?.evolutionLog[0]?.feedback === 'Public feedback');
    await api('/collections/' + collectionName, 'DELETE');
    check('health_drop_down', (await backend.getHealth()).status === 'down');
    await assert.rejects(() => backend.searchMemory(vector)); tests.push('down_query_not_empty_success');
    const disabled = new VectorMemoryService({ ...options, enabled: async () => false });
    check('disabled_not_qdrant_healthy', (await disabled.getHealth()).backend === 'disabled');
    await api('/collections/' + collectionName, 'PUT', { vectors: { size: 384, distance: 'Cosine' }, wal_config: { wal_capacity_mb: 1 } });
    check('wrong_schema_not_ready', (await backend.connect()).state === 'unavailable');
    const result = { scope: 'Real Qdrant backend only. App consumer acceptance is separate.', tests };
    fs.writeFileSync(process.env.QDRANT_CONSUMER_TEST_RESULT!, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
