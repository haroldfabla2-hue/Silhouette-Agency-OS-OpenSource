import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fsToolsForCapabilities, stepDeclaresFileWork, FS_JAIL_INSTRUCTION } from '../../services/tools/toolSelection';
import { evaluatePlanHonesty, antiTheaterEnabled } from '../../services/execution/stepHonesty';
import { collectWrittenArtifacts } from '../../services/execution/artifactLedger';
import { AgentCapability } from '../../types';

describe('W3 tool selection', () => {
    it('attaches nothing without filesystem capabilities', () => {
        expect(fsToolsForCapabilities([])).toHaveLength(0);
        expect(fsToolsForCapabilities([AgentCapability.TOOL_WEB_SEARCH])).toHaveLength(0);
    });
    it('read capability attaches read+list only', () => {
        const bundles = fsToolsForCapabilities([AgentCapability.ACTION_FILE_READ]);
        expect(bundles).toHaveLength(1);
        const names = (bundles[0].functionDeclarations as any[]).map(d => d.name);
        expect(names).toEqual(['read_file', 'list_files']);
    });
    it('write capability attaches write_file; read+write attach both bundles', () => {
        const w = fsToolsForCapabilities([AgentCapability.ACTION_FILE_WRITE]);
        expect(w).toHaveLength(1);
        expect((w[0].functionDeclarations as any[])[0].name).toBe('write_file');
        const rw = fsToolsForCapabilities([AgentCapability.ACTION_FILE_READ, AgentCapability.ACTION_FILE_WRITE]);
        expect(rw).toHaveLength(2);
    });
    it('jail instruction forbids simulated completion', () => {
        expect(FS_JAIL_INSTRUCTION).toMatch(/CONFINED/);
        expect(FS_JAIL_INSTRUCTION).toMatch(/NEVER claim a file exists/);
    });
});

describe('W3 file-work declaration', () => {
    it('explicit capability declares', () => {
        expect(stepDeclaresFileWork({ requiredCapabilities: [AgentCapability.ACTION_FILE_WRITE] })).toBe(true);
    });
    it('text heuristic catches build tasks (es/en)', () => {
        expect(stepDeclaresFileWork({ taskDescription: 'Crear el componente principal de la app' })).toBe(true);
        expect(stepDeclaresFileWork({ taskDescription: 'Build the landing page' })).toBe(true);
        expect(stepDeclaresFileWork({ taskDescription: 'Escribir el archivo de estilos' })).toBe(true);
    });
    it('pure research/prose steps do not declare', () => {
        expect(stepDeclaresFileWork({ taskDescription: 'Analizar tendencias del mercado peruano' })).toBe(false);
        expect(stepDeclaresFileWork({ taskDescription: 'Revisar el tono del briefing' })).toBe(false);
        expect(stepDeclaresFileWork({})).toBe(false);
    });
});

describe('W3 anti-theater gate', () => {
    beforeEach(() => { delete process.env.SILHOUETTE_ANTI_THEATER; });
    it('is strict by default', () => {
        expect(antiTheaterEnabled()).toBe(true);
    });
    it('FAILS a plan that declared file work with zero verified writes', () => {
        const v = evaluatePlanHonesty(true, 0);
        expect(v.pass).toBe(false);
        expect(v.error).toMatch(/ANTI_THEATER/);
        expect(v.error).toMatch(/zero verified writes/);
    });
    it('passes declared work with artifacts', () => {
        expect(evaluatePlanHonesty(true, 3).pass).toBe(true);
    });
    it('passes prose-only plans honestly', () => {
        expect(evaluatePlanHonesty(false, 0).pass).toBe(true);
    });
    it('respects the operator escape hatch', () => {
        process.env.SILHOUETTE_ANTI_THEATER = 'off';
        expect(antiTheaterEnabled()).toBe(false);
        expect(evaluatePlanHonesty(true, 0).pass).toBe(true);
    });
});

describe('W3 artifact ledger', () => {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-ledger-'));
    const LOG = path.join(TMP, 'audit.jsonl');
    afterAll(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

    function writeLines(entries: any[]) {
        fs.writeFileSync(LOG, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
        process.env.SILHOUETTE_FS_AUDIT_LOG = LOG;
    }

    it('collects allowed writes by actor since T', async () => {
        const now = Date.now();
        writeLines([
            { ts: new Date(now - 5000).toISOString(), op: 'write', decision: 'allowed', resolvedPath: '/w/a.ts', bytes: 10, sha256: 'x'.repeat(64), actor: 'agt_dyn_1' },
            { ts: new Date(now + 5000).toISOString(), op: 'write', decision: 'allowed', resolvedPath: '/w/b.ts', bytes: 20, actor: 'agt_dyn_1' },
            { ts: new Date(now + 6000).toISOString(), op: 'write', decision: 'denied', reason: 'escapes', requestedPath: '/etc/evil', actor: 'agt_dyn_1' },
            { ts: new Date(now + 7000).toISOString(), op: 'read', decision: 'allowed', resolvedPath: '/w/c.ts', actor: 'agt_dyn_1' },
            { ts: new Date(now + 8000).toISOString(), op: 'write', decision: 'allowed', resolvedPath: '/w/d.ts', actor: 'other_agent' },
        ]);
        const arts = await collectWrittenArtifacts(new Set(['agt_dyn_1']), now);
        expect(arts.map(a => a.path)).toEqual(['/w/b.ts']);
    });
    it('missing journal means zero artifacts (honest), never an error', async () => {
        process.env.SILHOUETTE_FS_AUDIT_LOG = path.join(TMP, 'nope.jsonl');
        expect(await collectWrittenArtifacts(new Set(['a']), 0)).toEqual([]);
    });
    it('skips corrupt journal lines without failing', async () => {
        writeLines([{ ts: new Date().toISOString(), op: 'write', decision: 'allowed', resolvedPath: '/w/ok.ts', actor: 'a' }]);
        fs.appendFileSync(LOG, '{corrupt json\n');
        const arts = await collectWrittenArtifacts(new Set(['a']), 0);
        expect(arts).toHaveLength(1);
    });
});
