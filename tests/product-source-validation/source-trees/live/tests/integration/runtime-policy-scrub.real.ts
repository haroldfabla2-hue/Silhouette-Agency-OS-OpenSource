import assert from 'node:assert/strict';
// This entry must run in its own provider-OFF process. No credentials or model calls.
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
assert.equal(process.env.SILHOUETTE_INFERENCE_MODE, 'cloud-only');
const {loadRuntimeEnvironment} = await import('../../server/config/runtimeCredentials.ts');
loadRuntimeEnvironment();
assert.equal(process.env.SILHOUETTE_INFERENCE_MODE, 'cloud-only');
const {localEmbeddingService} = await import('../../services/localEmbeddingService.ts');
assert.equal(await localEmbeddingService.getEmbedding('PUBLIC SCRUB POLICY CHECK'), null);
console.log('RUNTIME_SCRUB_CLOUD_ONLY_REAL_PASS');
