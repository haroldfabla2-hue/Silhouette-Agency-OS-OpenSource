import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenVault, redactSecret, VAULT_DIR_NAME } from '../../../services/auth/tokenVault';
import { acquireRefreshLock, FenceLostError } from '../../../services/auth/refreshLock';

const dirs: string[] = [];
function base(): string { const d = mkdtempSync(join(tmpdir(), 'tv-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const token = { accessToken: 'tok-live-123456', refreshToken: 'rt-9', obtainedAt: new Date().toISOString() };

describe('TokenVault', () => {
    it('writes 0600 inside a 0700 dir and reads back', () => {
        const v = new TokenVault(base());
        v.write('gemini', token);
        expect(statSync(v.dir).mode & 0o777).toBe(0o700);
        expect(statSync(join(v.dir, 'gemini.token.json')).mode & 0o777).toBe(0o600);
        expect(v.read('gemini')?.accessToken).toBe(token.accessToken);
        expect(v.dir.endsWith(VAULT_DIR_NAME)).toBe(true);
    });
    it('refuses to read a token file with loose permissions', () => {
        const v = new TokenVault(base());
        v.write('openai', token);
        chmodSync(join(v.dir, 'openai.token.json'), 0o644);
        expect(() => v.read('openai')).toThrow(/permissions/);
    });
    it('redacted view never exposes material', () => {
        const v = new TokenVault(base());
        v.write('copilot', token);
        const r = v.redacted('copilot');
        expect(JSON.stringify(r)).not.toContain(token.accessToken);
        expect(redactSecret(token.accessToken)).toBe('<redacted:15 chars>');
    });
    it('guarded write rejects a stale fence (late refresh write)', async () => {
        const d = base();
        const v = new TokenVault(d);
        const a = await acquireRefreshLock(d, 'gemini', { staleMs: 30 });
        await new Promise(r => setTimeout(r, 50));
        const b = await acquireRefreshLock(d, 'gemini', { staleMs: 30, maxWaitMs: 2000 });
        expect(() => v.write('gemini', token, a)).toThrow(FenceLostError);
        v.write('gemini', token, b);
        b.release();
    });
});
