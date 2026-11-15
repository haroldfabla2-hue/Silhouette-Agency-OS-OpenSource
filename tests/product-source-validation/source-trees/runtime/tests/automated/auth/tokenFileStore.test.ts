import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, chmodSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenFileStore, redactSecret, TOKEN_STORE_DIR_NAME, TokenKeyMissing } from '../../../services/auth/tokenFileStore';
import { acquireRefreshLock, FenceLostError } from '../../../services/auth/refreshLock';

const dirs: string[] = [];
function base(): string { const d = mkdtempSync(join(tmpdir(), 'ts-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const KEY = 'a'.repeat(64);
const env = { SILHOUETTE_TOKEN_KEY: KEY } as NodeJS.ProcessEnv;
const token = { accessToken: 'tok-live-123456', refreshToken: 'rt-9', obtainedAt: new Date().toISOString() };

describe('TokenFileStore', () => {
    it('fails closed without the encryption key: no plaintext tokens, ever', () => {
        expect(() => new TokenFileStore(base(), {} as NodeJS.ProcessEnv)).toThrow(TokenKeyMissing);
        expect(TokenFileStore.isAvailable({} as NodeJS.ProcessEnv)).toBe(false);
    });
    it('encrypts at rest: the access token never appears in the file bytes', () => {
        const d = base();
        const s = new TokenFileStore(d, env);
        s.write('gemini', token);
        const raw = readFileSync(join(s.dir, 'gemini.token.json'), 'utf8');
        expect(raw).not.toContain(token.accessToken);
        expect(raw).not.toContain(token.refreshToken!);
        expect(s.read('gemini')?.accessToken).toBe(token.accessToken);
        expect(s.dir.endsWith(TOKEN_STORE_DIR_NAME)).toBe(true);
    });
    it('writes 0600 inside 0700 and refuses loose-permission files', () => {
        const d = base();
        const s = new TokenFileStore(d, env);
        s.write('openai', token);
        expect(statSync(s.dir).mode & 0o777).toBe(0o700);
        expect(statSync(join(s.dir, 'openai.token.json')).mode & 0o777).toBe(0o600);
        chmodSync(join(s.dir, 'openai.token.json'), 0o644);
        expect(() => s.read('openai')).toThrow(/permissions/);
    });
    it('redacted view never exposes material', () => {
        const s = new TokenFileStore(base(), env);
        s.write('copilot', token);
        expect(JSON.stringify(s.redacted('copilot'))).not.toContain(token.accessToken);
        expect(redactSecret(token.accessToken)).toBe('<redacted:15 chars>');
    });
    it('guarded write rejects a stale fence (late refresh write)', async () => {
        const d = base();
        const s = new TokenFileStore(d, env);
        const a = await acquireRefreshLock(d, 'gemini', { staleMs: 30 });
        await new Promise(r => setTimeout(r, 50));
        const b = await acquireRefreshLock(d, 'gemini', { staleMs: 30, maxWaitMs: 2000 });
        expect(() => s.write('gemini', token, a)).toThrow(FenceLostError);
        s.write('gemini', token, b);
        b.release();
    });
});
