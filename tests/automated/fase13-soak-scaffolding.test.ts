/**
 * [Fase 5] Soak scaffolding verification.
 *
 * Runs tests/e2e/soak/runSoak.ts as REAL separate OS processes:
 * phase-a writes facts/incidents/costs, phase-b (a new process on the same
 * SQLite file) verifies they survived the process restart, and a short
 * smoke soak exercises the cycle runner + JSONL evidence output.
 *
 * The 24h soak itself needs Alberto's environment and decisions (Neo4j/Redis
 * hosting, LLM budget, external-channel credentials) - declared NOT_RUN in
 * the evidence, never faked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileP = promisify(execFile);
const RUNNER = path.resolve(__dirname, '../e2e/soak/runSoak.ts');

interface EvidenceEntry {
    ts: string; scenario: string; phase: string;
    result: 'PASS' | 'FAIL' | 'NOT_RUN'; detail: string;
}

function readEvidence(p: string): EvidenceEntry[] {
    return fs.readFileSync(p, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
}

describe('Fase 5: soak scaffolding', () => {
    let dir: string;
    let db: string;
    let evidencePath: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-scaffold-'));
        db = path.join(dir, 'soak.sqlite');
        evidencePath = path.join(dir, 'evidence.jsonl');
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('phase-a then phase-b (real process restart): memory, incidents and costs survive', async () => {
        await execFileP('npx', ['tsx', RUNNER, '--phase=a', '--db=' + db, '--evidence=' + evidencePath], { timeout: 90000 });
        await execFileP('npx', ['tsx', RUNNER, '--phase=b', '--db=' + db, '--evidence=' + evidencePath], { timeout: 90000 });

        const ev = readEvidence(evidencePath);
        const fails = ev.filter(e => e.result === 'FAIL');
        expect(fails, JSON.stringify(fails)).toEqual([]);

        // real restart evidence
        expect(ev.some(e => e.scenario === 'memory-write' && e.result === 'PASS')).toBe(true);
        const restart = ev.find(e => e.scenario === 'memory-read-after-restart');
        expect(restart?.result).toBe('PASS');
        expect(restart?.detail).toContain('survived process restart');

        // incident opened then resolved as the SAME incident
        expect(ev.some(e => e.scenario === 'incident-open' && e.result === 'PASS')).toBe(true);
        const rec = ev.find(e => e.scenario === 'incident-recovery');
        expect(rec?.result).toBe('PASS');
        expect(rec?.detail).toMatch(/open=1 resolved=1/);

        // costs logged and persisted across the restart
        expect(ev.some(e => e.scenario === 'cost-log' && e.result === 'PASS')).toBe(true);
        expect(ev.find(e => e.scenario === 'cost-persisted')?.result).toBe('PASS');

        // what cannot run here is declared, not faked
        const notRun = ev.filter(e => e.result === 'NOT_RUN').map(e => e.scenario);
        expect(notRun).toContain('approval-rejection');
        expect(notRun).toContain('full-mode-neo4j-redis');
        expect(notRun).toContain('inspected-prompts');
    }, 200000);

    it('smoke soak: cycles produce timestamped JSONL evidence and all pass', async () => {
        const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-smoke-'));
        const db2 = path.join(dir2, 'soak.sqlite');
        const ev2 = path.join(dir2, 'evidence.jsonl');
        try {
            await execFileP('npx', ['tsx', RUNNER, '--mode=soak', '--db=' + db2, '--evidence=' + ev2], {
                timeout: 120000,
                env: { ...process.env, SOAK_DURATION_MS: '8000', SOAK_CYCLE_EVERY_MS: '300' }
            });

            const ev = readEvidence(ev2);
            const fails = ev.filter(e => e.result === 'FAIL');
            expect(fails, JSON.stringify(fails)).toEqual([]);

            const cycles = ev.filter(e => e.scenario === 'cycle');
            expect(cycles.length).toBeGreaterThanOrEqual(2);
            // monotonic real timestamps
            const times = cycles.map(c => Date.parse(c.ts));
            expect([...times].sort((a, b) => a - b)).toEqual(times);
            // every cycle wrote and read back real state
            expect(ev.filter(e => e.scenario === 'memory-read-after-restart' && e.result === 'PASS').length).toBe(cycles.length);
        } finally {
            fs.rmSync(dir2, { recursive: true, force: true });
        }
    }, 200000);
});
