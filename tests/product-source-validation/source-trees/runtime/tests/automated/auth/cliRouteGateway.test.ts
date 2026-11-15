/**
 * INTERNAL E2E traversal: a real AgentInferenceRequest enters the real
 * gateway entry (createAgentInferenceRouter -> completeText -> streamPrepared)
 * and is answered by the CLI-route adapter through a REAL spawn. The `codex`
 * binary is a DECLARED TEST DOUBLE (tmp script, real PATH resolution through
 * resolveOfficialBin with the tmp dir allowlisted): it proves the gateway
 * traversal, account routing and env isolation - NOT vendor login, which
 * stays PENDING owner accounts/plans.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../../services/auth/accountStore';
import { cliRouteAdapter } from '../../../services/llm/cliRouteAdapter';
import { createAgentInferenceRouter } from '../../../services/llm/agentInferenceRouter';

const dirs: string[] = [];
function base(): string { const d = mkdtempSync(join(tmpdir(), 'gw-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function setup(scriptBody: string) {
    const d = base();
    const binDir = join(d, 'bin');
    writeFileSync(join(d, 'a.db'), '');
    const fs = require('node:fs');
    fs.mkdirSync(binDir);
    const script = join(binDir, 'codex');
    writeFileSync(script, `#!/bin/sh\n${scriptBody}\n`);
    chmodSync(script, 0o755);
    const store = new AccountStore(join(d, 'a.db'));
    const env = { PATH: binDir, HOME: d, X: '1' } as NodeJS.ProcessEnv;
    return { d, binDir, store, env };
}

describe('gateway traversal through a CLI route', () => {
    it('a real request through the router is answered by the active CLI account', async () => {
        const { d, binDir, store, env } = setup('echo "codex-answer args=[$2] home=$HOME gk=${GEMINI_API_KEY:-none}"');
        store.add({ providerId: 'OPENAI_CODEX', accountId: 'work', label: 'W', method: 'command', secretRef: 'env:X' });
        store.activate('OPENAI_CODEX', 'work');
        const adapter = cliRouteAdapter('codex-cli-authjson', { store, env, allowedBinDirs: [binDir] });
        expect(await adapter.isAvailable()).toBe(true);
        const router = createAgentInferenceRouter({ adapters: [adapter], chain: ['OPENAI_CODEX'] });
        const text = await router.completeText('hola gateway');
        expect(text).toContain('codex-answer');
        expect(text).toContain('args=[hola gateway]');
        expect(text).toContain('gk=none'); // env isolation: server secrets never reach the vendor CLI
        store.close();
    });
    it('without an active CLI account the router fails over with typed evidence', async () => {
        const { binDir, store, env } = setup('echo should-not-run');
        const adapter = cliRouteAdapter('codex-cli-authjson', { store, env, allowedBinDirs: [binDir] });
        expect(await adapter.isAvailable()).toBe(false); // no account registered
        const router = createAgentInferenceRouter({ adapters: [adapter], chain: ['OPENAI_CODEX'] });
        await expect(router.completeText('hola')).rejects.toThrow(/OPENAI_CODEX: unavailable/);
        store.close();
    });
});
