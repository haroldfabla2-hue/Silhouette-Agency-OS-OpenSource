import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    resolveWrite,
    resolveRead,
    maxWriteBytes,
    auditFs,
    sha256Of,
} from '../../services/tools/fileJail';

// W2 — filesystem jail. Hermetic: roots point at per-test tmp dirs via env,
// never at the real workspace. Fail-closed behavior is asserted explicitly.
const TMP_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-jail-'));
const WRITE_ROOT = path.join(TMP_BASE, 'workspace');
const READ_ROOT = path.join(TMP_BASE, 'readable');
const OUTSIDE = path.join(TMP_BASE, 'outside');
const AUDIT_LOG = path.join(TMP_BASE, 'audit.jsonl');

function resetEnv() {
    process.env.SILHOUETTE_FS_WRITE_ROOTS = WRITE_ROOT;
    process.env.SILHOUETTE_FS_READ_ROOTS = READ_ROOT;
    process.env.SILHOUETTE_FS_AUDIT_LOG = AUDIT_LOG;
    delete process.env.SILHOUETTE_FS_MAX_WRITE_BYTES;
}

beforeEach(() => {
    fs.rmSync(TMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(WRITE_ROOT, { recursive: true });
    fs.mkdirSync(READ_ROOT, { recursive: true });
    fs.mkdirSync(OUTSIDE, { recursive: true });
    resetEnv();
});

afterAll(() => {
    fs.rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('W2 file jail — write resolution', () => {
    it('allows a new file inside the write root', () => {
        const r = resolveWrite(path.join(WRITE_ROOT, 'proj', 'src', 'app.ts'));
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.resolved).toBe(path.join(fs.realpathSync(WRITE_ROOT), 'proj', 'src', 'app.ts'));
    });
    it('rejects traversal escaping the root', () => {
        const r = resolveWrite(path.join(WRITE_ROOT, '..', 'outside', 'evil.ts'));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/escapes allowed roots/);
    });
    it('rejects absolute paths outside every root', () => {
        expect(resolveWrite('/etc/cron.d/evil').ok).toBe(false);
        expect(resolveWrite(path.join(OUTSIDE, 'evil.ts')).ok).toBe(false);
    });
    it('rejects writes through a symlink that escapes the root', () => {
        fs.symlinkSync(OUTSIDE, path.join(WRITE_ROOT, 'link-out'));
        const r = resolveWrite(path.join(WRITE_ROOT, 'link-out', 'evil.ts'));
        expect(r.ok).toBe(false);
    });
    it('rejects secret-bearing names even inside the root', () => {
        for (const name of ['.env', '.env.local', 'server.pem', 'id_rsa', 'app.sqlite', 'credentials.json']) {
            const r = resolveWrite(path.join(WRITE_ROOT, name));
            expect(r.ok).toBe(false);
        }
    });
    it('rejects anything traversing .git', () => {
        expect(resolveWrite(path.join(WRITE_ROOT, 'proj', '.git', 'config')).ok).toBe(false);
    });
    it('rejects empty paths', () => {
        expect(resolveWrite('').ok).toBe(false);
    });
});

describe('W2 file jail — read resolution', () => {
    it('allows reads inside the read root', () => {
        fs.writeFileSync(path.join(READ_ROOT, 'note.txt'), 'hola');
        const r = resolveRead(path.join(READ_ROOT, 'note.txt'));
        expect(r.ok).toBe(true);
    });
    it('denies secret files inside the read root', () => {
        fs.writeFileSync(path.join(READ_ROOT, '.env'), 'SECRET=1');
        const r = resolveRead(path.join(READ_ROOT, '.env'));
        expect(r.ok).toBe(false);
    });
    it('denies reads outside read roots', () => {
        expect(resolveRead('/etc/shadow').ok).toBe(false);
    });
    it('write roots and read roots are independent', () => {
        // a path inside the read root is NOT writable
        const r = resolveWrite(path.join(READ_ROOT, 'note.txt'));
        expect(r.ok).toBe(false);
    });
});

describe('W2 file jail — caps and audit', () => {
    it('honors the size cap env', () => {
        expect(maxWriteBytes()).toBe(1_048_576);
        process.env.SILHOUETTE_FS_MAX_WRITE_BYTES = '64';
        expect(maxWriteBytes()).toBe(64);
        process.env.SILHOUETTE_FS_MAX_WRITE_BYTES = 'garbage';
        expect(maxWriteBytes()).toBe(1_048_576); // fail to safe default
    });
    it('journals allowed and denied decisions', async () => {
        await auditFs({ op: 'write', requestedPath: '/x/ok.ts', decision: 'allowed', resolvedPath: '/x/ok.ts', bytes: 10, sha256: sha256Of('0123456789'), actor: 'agt_dyn_1' });
        await auditFs({ op: 'write', requestedPath: '/etc/evil', decision: 'denied', reason: 'escapes allowed roots', actor: 'agt_dyn_1' });
        const lines = fs.readFileSync(AUDIT_LOG, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
        expect(lines).toHaveLength(2);
        expect(lines[0].decision).toBe('allowed');
        expect(lines[0].actor).toBe('agt_dyn_1');
        expect(lines[0].sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(lines[1].decision).toBe('denied');
        expect(lines[1].reason).toMatch(/escapes/);
        expect(lines[0].ts).toBeTruthy();
    });
    it('never journals secrets: denied entries carry no content', async () => {
        await auditFs({ op: 'read', requestedPath: '/r/.env', decision: 'denied', reason: 'environment files may contain secrets' });
        const raw = fs.readFileSync(AUDIT_LOG, 'utf-8');
        expect(raw).not.toContain('SECRET');
    });
});
