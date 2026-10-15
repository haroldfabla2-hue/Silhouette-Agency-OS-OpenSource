/**
 * [REA Fase 2] Bounded squad wrapper for the REA CLI. Hermetic: a shim
 * executable stands in for the real binary; every decision path is audited.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runRea, classifyCommand, inOvernightWindow, REA_BLOCKED_COMMANDS } from '../../services/tools/reaTool';

const SHIM = `#!/usr/bin/env node
const big = 'x'.repeat(Number(process.env.SHIM_BIG_BYTES || 0));
process.stderr.write(process.env.SHIM_STDERR || '');
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), big }));
process.exit(Number(process.env.SHIM_EXIT || 0));
`;

const DAY = new Date('2026-10-15T12:00:00');   // noon local -> outside 2-6
const NIGHT = new Date('2026-10-15T03:00:00'); // 3am local -> inside 2-6

const saved: Record<string, string | undefined> = {};
function setEnv(k: string, v: string) { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; }

describe('REA squad tool wrapper', () => {
    let dir: string; let bin: string; let audit: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'rea-tool-'));
        bin = join(dir, 'rea-shim');
        writeFileSync(bin, SHIM); chmodSync(bin, 0o755);
        audit = join(dir, 'audit.jsonl');
        setEnv('SILHOUETTE_REA_BIN', bin);
        setEnv('SILHOUETTE_REA_ENV_FILE', '');
        setEnv('SILHOUETTE_REA_AUDIT_LOG', audit);
    });
    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; delete saved[k]; }
        rmSync(dir, { recursive: true, force: true });
    });
    const auditLines = () => existsSync(audit) ? readFileSync(audit, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];

    it('classifies commands fail-closed: blocked > daylight > overnight', () => {
        for (const c of ['install', 'update', 'mcp', 'debug-with-gdb', 'cutter-command']) {
            expect(REA_BLOCKED_COMMANDS.has(c)).toBe(true);
            expect(classifyCommand(c)).toBe('blocked');
        }
        expect(classifyCommand('analyze-javascript-application')).toBe('daylight');
        expect(classifyCommand('analyze-web-bundle')).toBe('daylight');
        expect(classifyCommand('trace-javascript-semantics')).toBe('daylight');
        expect(classifyCommand('analyze')).toBe('overnight'); // generic: fail-closed to overnight
        expect(classifyCommand('capture-native-ui-scenario')).toBe('overnight');
        expect(classifyCommand('totally-unknown-future-cmd')).toBe('overnight');
    });

    it('overnight window math incl. wrap-around', () => {
        expect(inOvernightWindow(DAY)).toBe(false);
        expect(inOvernightWindow(NIGHT)).toBe(true);
    });

    it('honest UNAVAILABLE when the binary is missing (audited, fail-closed)', async () => {
        setEnv('SILHOUETTE_REA_BIN', join(dir, 'does-not-exist'));
        const r = await runRea({ command: 'analyze-javascript-application', target: '/tmp/x', entitlement: 'our own build', now: DAY });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('UNAVAILABLE');
        expect(auditLines().at(-1).decision).toBe('denied-unavailable');
    });

    it('blocked commands are denied and audited', async () => {
        const r = await runRea({ command: 'update', entitlement: 'self update attempt', now: NIGHT });
        expect(r.ok).toBe(false);
        expect(auditLines().at(-1).decision).toBe('denied-blocked');
    });

    it('entitlement is required (audited)', async () => {
        const r = await runRea({ command: 'analyze-javascript-application', target: '/tmp/x', entitlement: '', now: DAY });
        expect(r.ok).toBe(false);
        expect(auditLines().at(-1).decision).toBe('denied-entitlement');
    });

    it('secret-bearing targets are denied (same bar as the fs jail)', async () => {
        const r = await runRea({ command: 'analyze-javascript-application', target: '/opt/silhouette/.env', entitlement: 'should never pass', now: DAY });
        expect(r.ok).toBe(false);
        expect(auditLines().at(-1).decision).toBe('denied-target');
    });

    it('daylight command runs by day with forced bounding flags and records evidence sha256', async () => {
        const r = await runRea({ command: 'analyze-javascript-application', target: '/tmp/app', filter: 'modules,endpoints', entitlement: 'our own dist build', purpose: 'spec', now: DAY });
        expect(r.ok).toBe(true);
        if (r.ok) {
            const argv = (r.output as any).argv as string[];
            expect(argv[0]).toBe('analyze-javascript-application');
            expect(argv).toContain('--format'); expect(argv).toContain('json');
            expect(argv).toContain('--token-limit');
            expect(argv).toContain('--filter-output'); expect(argv).toContain('modules,endpoints');
            expect(r.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
        }
        const entry = auditLines().at(-1);
        expect(entry.decision).toBe('allowed-daylight');
        expect(entry.entitlement).toBe('our own dist build');
        expect(entry.stdoutSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('native command is denied by day and allowed in the overnight window', async () => {
        const day = await runRea({ command: 'capture-native-ui-scenario', target: '/tmp/app', entitlement: 'our own build', now: DAY });
        expect(day.ok).toBe(false);
        expect(auditLines().at(-1).decision).toBe('denied-window');
        const night = await runRea({ command: 'capture-native-ui-scenario', target: '/tmp/app', entitlement: 'our own build', now: NIGHT });
        expect(night.ok).toBe(true);
        expect(auditLines().at(-1).decision).toBe('allowed-overnight');
    });

    it('oversize output is truncated with an explicit marker, never dumped whole', async () => {
        setEnv('SHIM_BIG_BYTES', '500000');
        setEnv('SILHOUETTE_REA_MAX_OUTPUT_BYTES', '4096');
        const r = await runRea({ command: 'analyze-web-bundle', target: 'https://example.com', entitlement: 'public web surface', now: DAY });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.truncated).toBe(true);
            expect(r.raw).toContain('[TRUNCATED');
            expect(Buffer.byteLength(r.raw, 'utf-8')).toBeLessThan(5000);
        }
        expect(auditLines().at(-1).truncated).toBe(true);
    });

    it('non-zero exit surfaces a bounded error, audited as error', async () => {
        setEnv('SHIM_EXIT', '3');
        setEnv('SHIM_STDERR', 'ghidra exploded');
        const r = await runRea({ command: 'analyze-web-bundle', target: 'https://example.com', entitlement: 'public web surface', now: DAY });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('ghidra exploded');
        expect(auditLines().at(-1).decision).toBe('error');
    });
});
