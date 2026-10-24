import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../../services/auth/accountStore';
import { TokenVault } from '../../../services/auth/tokenVault';
import { CredentialResolver } from '../../../services/auth/credentialResolver';
import { OpenAICompatibleClient } from '../../../services/llm/openAICompatible';
import { AdmissionQueue } from '../../../services/llm/admissionQueue';
import type { ProviderDefinition } from '../../../services/llm/providerRegistry';

const dirs: string[] = [];
function base(): string { const d = mkdtempSync(join(tmpdir(), 'cr-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

let server: Server | undefined;
afterEach(() => new Promise<void>(r => { if (!server) return r(); server.close(() => r()); server = undefined; }));

function provider(port: number): ProviderDefinition {
    return { id: 'GROQ', transport: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: 'GROQ_API_KEY', model: 'test-model' };
}

async function startProvider(seen: { auth?: string; lanes: string[] }): Promise<number> {
    server = createServer((req, res) => {
        seen.auth = req.headers.authorization as string;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            model: 'test-model', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        }));
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    return (server!.address() as any).port;
}

describe('credential wiring into real transport', () => {
    it('calls the provider with the ACTIVE account credential from the vault', async () => {
        const d = base();
        const store = new AccountStore(join(d, 'a.db'));
        const vault = new TokenVault(d);
        vault.write('groq-work', { accessToken: 'vault-key-live', obtainedAt: new Date().toISOString() });
        store.add({ providerId: 'GROQ', accountId: 'work', label: 'Work', method: 'api-key', secretRef: 'vault:groq-work' });
        store.activate('GROQ', 'work');
        const resolver = new CredentialResolver(store, vault, {} as NodeJS.ProcessEnv);
        const seen = { auth: undefined as string | undefined, lanes: [] as string[] };
        const port = await startProvider(seen);
        const admission = new AdmissionQueue(1);
        const client = new OpenAICompatibleClient({} as NodeJS.ProcessEnv, fetch, resolver, admission);
        expect(client.configured(provider(port))).toBe(true);
        const result = await client.complete(provider(port), [{ role: 'user', content: 'hi' }], { lane: 'conversational' });
        expect(result.text).toBe('ok');
        expect(seen.auth).toBe('Bearer vault-key-live');
        store.close();
    });
    it('env account resolves from the environment; expired vault tokens fail closed', async () => {
        const d = base();
        const store = new AccountStore(join(d, 'a.db'));
        const vault = new TokenVault(d);
        store.add({ providerId: 'GROQ', accountId: 'envacc', label: 'Env', method: 'env', secretRef: 'env:GROQ_API_KEY' });
        store.activate('GROQ', 'envacc');
        const resolver = new CredentialResolver(store, vault, { GROQ_API_KEY: 'env-key-1' } as NodeJS.ProcessEnv);
        expect(resolver.resolve(provider(0))?.key).toBe('env-key-1');
        // expired vault token: status flips to expired, resolver refuses
        vault.write('groq-old', { accessToken: 'dead', expiresAt: new Date(Date.now() - 1000).toISOString(), obtainedAt: new Date().toISOString() });
        store.add({ providerId: 'NVIDIA', accountId: 'old', label: 'Old', method: 'api-key', secretRef: 'vault:groq-old' });
        store.activate('NVIDIA', 'old');
        expect(resolver.resolve({ id: 'NVIDIA', transport: 'openai-compatible', baseUrl: 'http://x', apiKeyEnv: 'NVIDIA_API_KEY', model: 'm' })).toBeUndefined();
        expect(store.list('NVIDIA')[0].status).toBe('expired');
        store.close();
    });
    it('without accounts the client falls back to the provider env var (legacy path intact)', async () => {
        const d = base();
        const store = new AccountStore(join(d, 'a.db'));
        const vault = new TokenVault(d);
        const resolver = new CredentialResolver(store, vault, {} as NodeJS.ProcessEnv);
        const seen = { auth: undefined as string | undefined, lanes: [] as string[] };
        const port = await startProvider(seen);
        const client = new OpenAICompatibleClient({ GROQ_API_KEY: 'legacy-env-key' } as NodeJS.ProcessEnv, fetch, resolver);
        const result = await client.complete(provider(port), [{ role: 'user', content: 'hi' }]);
        expect(result.text).toBe('ok');
        expect(seen.auth).toBe('Bearer legacy-env-key');
        store.close();
    });
});
