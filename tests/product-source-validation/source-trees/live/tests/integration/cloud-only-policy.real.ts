import assert from 'node:assert/strict';
import { localInferenceAllowed, assertLocalInferenceAllowed } from '../../services/security/localInferencePolicy.ts';
import { localEmbeddingService } from '../../services/localEmbeddingService.ts';
import { ollamaService } from '../../services/ollamaService.ts';

process.env.SILHOUETTE_INFERENCE_MODE = 'cloud-only';
assert.equal(localInferenceAllowed(), false);
assert.throws(() => assertLocalInferenceAllowed(), /LOCAL_INFERENCE_DISABLED/);
assert.equal(await localEmbeddingService.getEmbedding('PUBLIC NO LOCAL INFERENCE'), null);
assert.equal(await ollamaService.checkStatus(), false);
assert.equal(await ollamaService.isAvailable(), false);
await assert.rejects(() => ollamaService.generateCompletion('PUBLIC'), /LOCAL_INFERENCE_DISABLED/);
await assert.rejects(() => ollamaService.generateEmbedding('PUBLIC'), /LOCAL_INFERENCE_DISABLED/);
await assert.rejects(() => ollamaService.generateSimpleResponse('PUBLIC'), /LOCAL_INFERENCE_DISABLED/);
await assert.rejects(() => ollamaService.generateStream('PUBLIC').next(), /LOCAL_INFERENCE_DISABLED/);
await assert.rejects(() => ollamaService.generateChatStream([{role:'user',content:'PUBLIC'}]).next(), /LOCAL_INFERENCE_DISABLED/);
await assert.rejects(() => (ollamaService as any).processJob({data:{}}), /LOCAL_INFERENCE_DISABLED/);
assert.equal(await ollamaService.unloadModel('PUBLIC_NOT_A_MODEL'), false);
process.env.SILHOUETTE_INFERENCE_MODE = 'invalid';
assert.throws(() => localInferenceAllowed(), /Invalid SILHOUETTE_INFERENCE_MODE/);
await assert.rejects(() => localEmbeddingService.getEmbedding('PUBLIC'), /Invalid SILHOUETTE_INFERENCE_MODE/);
process.env.SILHOUETTE_INFERENCE_MODE = 'mixed';
assert.equal(localInferenceAllowed(), true);
assert.doesNotThrow(() => assertLocalInferenceAllowed());
delete process.env.SILHOUETTE_INFERENCE_MODE;
assert.equal(localInferenceAllowed(), true);
// Mixed compatibility is a policy result, not permission to run a local model.
console.log('CLOUD_ONLY_POLICY_PUBLIC_FIXTURE_PASS');
