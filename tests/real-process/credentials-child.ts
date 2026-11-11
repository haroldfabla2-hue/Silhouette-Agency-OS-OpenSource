import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acceptanceBoot, externalProvidersDisabled } from '../../server/config/runtimeCredentials';
import { configLoader } from '../../server/config/configLoader';
import { loadConfig } from '../../server/config/configSchema';
import { sqliteService } from '../../services/sqliteService';
import { AccountStore } from '../../services/auth/accountStore';
import { TokenFileStore } from '../../services/auth/tokenFileStore';
import { CredentialResolver } from '../../services/auth/credentialResolver';
import { OpenAICompatibleClient } from '../../services/llm/openAICompatible';

const disabled = externalProvidersDisabled();
const acceptance = acceptanceBoot();
const before = fs.readFileSync('silhouette.config.json');
const sentinel = 'isolated-credential-not-a-real-key';
if (!disabled) {
    sqliteService.setConfig('systemApiKey', sentinel);
    sqliteService.setConfig('secretsVault_example', { token: sentinel });
    sqliteService.setConfig('plain-preference', 'keep');
}
const config = configLoader.getConfig();
const alternate = loadConfig();
assert.equal(Boolean(config.llm.providers.gemini?.apiKey), !disabled);
assert.equal(Boolean(alternate.llm.providers.gemini?.apiKey), !disabled);
assert.equal(Boolean(process.env.GEMINI_API_KEY), !disabled);
assert.equal(Boolean(process.env.CUSTOM_PROVIDER_CREDENTIAL), !disabled);
assert.equal(Boolean(sqliteService.getConfig('systemApiKey')), !disabled);
assert.equal(Boolean(sqliteService.getAllConfig().secretsVault_example), !disabled);
assert.equal(sqliteService.getConfig('plain-preference'), 'keep');
const raw = sqliteService.db.prepare('SELECT value FROM system_config WHERE key=?').get('systemApiKey') as any;
assert.equal(JSON.parse(raw.value), sentinel); // Runtime masking is not deletion.
const store = new AccountStore(path.resolve('accounts.db'));
const tokenKey = '12'.repeat(32);
const tokens = new TokenFileStore(path.resolve('tokens'), { SILHOUETTE_TOKEN_KEY: tokenKey });
if (!disabled) {
    store.add({ providerId: 'EXAMPLE', accountId: 'local', label: 'test-only', method: 'api-key', secretRef: 'env:CUSTOM_PROVIDER_CREDENTIAL' });
    store.activate('EXAMPLE', 'local');
    tokens.write('local-test', { accessToken: sentinel, obtainedAt: new Date().toISOString() });
    store.add({ providerId: 'TOKENEXAMPLE', accountId: 'file', label: 'test-only', method: 'api-key', secretRef: 'vault:local-test' });
    store.activate('TOKENEXAMPLE', 'file');
}
const accountBefore = JSON.stringify(store.active('EXAMPLE'));
const resolver = new CredentialResolver(store, tokens, { CUSTOM_PROVIDER_CREDENTIAL: sentinel });
const provider = { id: 'EXAMPLE', transport: 'openai-compatible' as const, model: 'local-test', baseUrl: 'http://127.0.0.1:1', apiKeyEnv: 'CUSTOM_PROVIDER_CREDENTIAL' };
assert.equal(Boolean(resolver.resolve(provider)), !disabled);
const tokenFile = path.resolve(tokens.dir, 'local-test.token.json');
const tokenBefore = fs.readFileSync(tokenFile);
assert.equal(Boolean(resolver.resolve({ ...provider, id: 'TOKENEXAMPLE' })), !disabled);
assert.equal(fs.readFileSync(tokenFile).equals(tokenBefore), true);
assert.equal(JSON.stringify(store.active('EXAMPLE')), accountBefore);
const client = new OpenAICompatibleClient({ CUSTOM_PROVIDER_CREDENTIAL: sentinel });
assert.equal(client.configured(provider), !disabled); // Explicit custom env cannot bypass acceptance.
if (disabled) {
    await assert.rejects(() => client.complete(provider, [{ role: 'user', content: 'isolated' }]), /credential not configured/);
    assert.equal(config.autonomy.enabled, !acceptance);
    assert.equal(config.scheduler.enabled, !acceptance);
    if (!acceptance) {
        assert.equal(config.modules.graph, true);
        assert.equal(config.modules.redis, true);
        assert.equal(config.modules.vectorDB, true);
        assert.equal(config.memory.neo4j.uri, 'bolt://127.0.0.1:17687');
        assert.equal(config.memory.neo4j.password, 'isolated-local-store-not-a-real-key');
        assert.equal(process.env.NEO4J_URI, 'bolt://127.0.0.1:17687');
        assert.equal(process.env.NEO4J_PASSWORD, 'isolated-local-store-not-a-real-key');
        assert.equal(process.env.REDIS_URL, 'redis://127.0.0.1:16379');
        const { BrainClient } = await import('../../services/brain/brainClient');
        const relay = new BrainClient({ enabled: true, baseUrl: 'http://127.0.0.1:1', apiKey: sentinel });
        assert.equal(relay.isEnabled(), false);
        relay.reconfigure({ enabled: true, apiKey: sentinel });
        assert.equal(relay.isEnabled(), false);
        const { configureGenAI, hasGeminiKey, generateText } = await import('../../services/geminiService');
        assert.throws(() => configureGenAI(sentinel), /disabled/);
        await assert.rejects(() => generateText('fixture must not reach fallback'), /disabled/);
        const { llmGateway } = await import('../../services/llmGateway');
        await assert.rejects(() => llmGateway.complete('fixture denied before router'), /disabled/);
        process.env.GEMINI_API_KEY = sentinel; // Late env mutation cannot bypass native SDK gate.
        assert.equal(hasGeminiKey(), false);
        delete process.env.GEMINI_API_KEY;
        process.env.SILHOUETTE_PROVIDERS = 'on';
        assert.equal(externalProvidersDisabled(), true); // Latched until restart.
        sqliteService.setConfig('local-memory-marker', { content: 'fixture-preserved' });
        assert.deepEqual(sqliteService.getConfig('local-memory-marker'), { content: 'fixture-preserved' });
    }
    assert.deepEqual(config.channels, {});
    assert.equal(config.brain.enabled, false);
    assert.equal(process.env.SILHOUETTE_HOST, '127.0.0.1');
    assert.throws(() => sqliteService.setConfig('systemApiKey', 'changed'), /disabled/);
    assert.throws(() => configLoader.saveConfig({ system: config.system }), /disabled/);
}
assert.equal(fs.readFileSync('silhouette.config.json').equals(before), true);
assert.equal(fs.readFileSync('.env').toString().includes(sentinel), true);
store.close();sqliteService.db.close();
console.log(JSON.stringify({ mode: acceptance ? 'acceptance' : disabled ? 'providers-off' : 'normal', sources: ['inherited-custom-env','dotenv-file','config-json-both-loaders','sqlite-config','active-account-env','encrypted-token-file','explicit-client-env'], credentialsAvailable: !disabled, persistedCredentialUnchanged: true, accountUnchanged: true, configUnchanged: true, localStoresConfigured: disabled && !acceptance }));
// Native Gemini module imports legacy interval services. Assertions above are
// awaited; terminate this fixture child instead of leaving those loops alive.
process.exit(0);
