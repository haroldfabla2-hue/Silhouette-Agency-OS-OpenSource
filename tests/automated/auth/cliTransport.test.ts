/**
 * Mechanics tests for the official-CLI transport. The `codex` binary here is
 * a DECLARED TEST DOUBLE (a shell script in tmp): it proves routing, timeout
 * and redaction mechanics ONLY. It is not evidence of vendor login - real
 * Codex/Claude/Copilot login validation stays PENDING owner accounts/plans.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCliInvocation, runOfficialCli, redactCliOutput, CliRouteError } from '../../../services/auth/cliTransport';
import type { ProviderAccount } from '../../../services/auth/accountStore';

const dirs: string[] = [];
function base(): string { const d = mkdtempSync(join(tmpdir(), 'cli-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function fakeBin(d: string, body: string): string {
    const p = join(d, 'codex');
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
}

const account = (ref: string): ProviderAccount => ({
    providerId: 'OPENAI_CODEX', accountId: 'work', label: 'Work', method: 'command',
    status: 'active', secretRef: ref, createdAt: '', updatedAt: '',
});

describe('cliTransport', () => {
    it('routes the active account through its own CLI home (vendor login stays in vendor files)', async () => {
        const d = base();
        const home = join(d, 'codex-home-work');
        const bin = fakeBin(d, 'echo "HOME_IS=$CODEX_HOME"; echo "ARGS=$*"');
        const inv = buildCliInvocation(account(`cli-home:${home}`), bin, ['exec', 'hi'], {} as NodeJS.ProcessEnv, { allowAbsoluteBin: true });
        expect(inv.env.CODEX_HOME).toBe(home);
        const result = await runOfficialCli(inv);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(`HOME_IS=${home}`);
        expect(result.stdout).toContain('ARGS=exec hi');
    });
    it('env: routing passes only the named var to the child; unknown refs rejected', () => {
        const d = base();
        const inv = buildCliInvocation(account('env:CLAUDE_OFFICIAL_TOKEN'), 'claude', ['-p', 'hi'],
            { CLAUDE_OFFICIAL_TOKEN: 'official-secret' } as NodeJS.ProcessEnv);
        expect(inv.env.CLAUDE_OFFICIAL_TOKEN).toBe('official-secret');
        expect(() => buildCliInvocation(account('vault:nope'), 'claude', [], {} as NodeJS.ProcessEnv)).toThrow(CliRouteError);
        expect(() => buildCliInvocation(account('env:MISSING_VAR'), 'claude', [], {} as NodeJS.ProcessEnv)).toThrow(/not set/);
        expect(() => buildCliInvocation(account('env:X'), '/bin/sh -c evil', [], { X: '1' } as NodeJS.ProcessEnv)).toThrow(/bare executable/);
    });
    it('kills runaway children at the timeout', async () => {
        const d = base();
        const bin = fakeBin(d, 'sleep 30');
        const inv = buildCliInvocation(account('env:X'), bin, [], { X: '1' } as NodeJS.ProcessEnv, { allowAbsoluteBin: true });
        const result = await runOfficialCli(inv, { timeoutMs: 200 });
        expect(result.timedOut).toBe(true);
    });
    it('redacts token-shaped material from child output before it can reach logs', async () => {
        const d = base();
        const bin = fakeBin(d, 'echo "leaked sk-ABCDEFGHIJ12345 and ghp_abcdefghijklm"');
        const inv = buildCliInvocation(account('env:X'), bin, [], { X: '1' } as NodeJS.ProcessEnv, { allowAbsoluteBin: true });
        const result = await runOfficialCli(inv);
        expect(result.stdout).not.toContain('sk-ABCDEFGHIJ12345');
        expect(result.stdout).not.toContain('ghp_abcdefghijklm');
        expect(redactCliOutput('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toBe('<redacted-output>');
    });
});
