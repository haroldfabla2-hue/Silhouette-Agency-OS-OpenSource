import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const dirs: string[] = [];
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'offline-topology-')); dirs.push(dir); return dir; };
const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/measure_biomimetic_topology.ts'), ...args], { encoding: 'utf8', timeout: 15_000 });
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe('offline topology CLI with explicit local inputs', () => {
    it('reads an isolated SQLite copy without changing its bytes and reports empty journal honestly', () => {
        const path = join(fresh(), 'copy.sqlite');
        const db = new Database(path);
        db.exec("CREATE TABLE graph_edges(source TEXT,target TEXT,type TEXT); CREATE TABLE discovery_journal(decision TEXT); INSERT INTO graph_edges VALUES ('a','b','RELATED_TO'),('b','c','RELATED_TO'),('a','c','RELATED_TO');");
        db.close();
        const before = readFileSync(path);
        const result = run('--sqlite', path);
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ status: 'measured', discoveryJournalDecisionCounts: [], uniqueUndirectedEdges: 3 });
        expect(readFileSync(path).equals(before)).toBe(true);
        expect(existsSync(`${path}-wal`)).toBe(false);
    });
    it('fails on missing SQLite path instead of creating a new database', () => {
        const path = join(fresh(), 'missing.sqlite');
        expect(run('--sqlite', path).status).toBe(1);
        expect(existsSync(path)).toBe(false);
    });
    it('JSON empty graph gives no metrics and no journal, malformed input fails', () => {
        const path = join(fresh(), 'edges.json');
        writeFileSync(path, '[]');
        const result = run('--json', path);
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ status: 'insufficient-data', metrics: null, discoveryJournalDecisionCounts: null });
        writeFileSync(path, '{}');
        expect(run('--json', path).status).toBe(1);
    });
});
