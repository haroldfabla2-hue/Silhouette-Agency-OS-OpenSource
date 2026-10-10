import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// Regression: several processes opening the same fresh DB file used to race in runMigrations
// ("UNIQUE constraint failed: system_migrations.version"), failing CI intermittently.
describe('SqliteService migrations under concurrent startup', () => {
    it('16 processes on one fresh DB: all start, each migration recorded exactly once', async () => {
        const root = path.resolve(__dirname, '..', '..');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sil-mig-race-'));
        fs.mkdirSync(path.join(tmp, 'db', 'migrations'), { recursive: true });
        fs.cpSync(path.join(root, 'db', 'migrations', 'sqlite'), path.join(tmp, 'db', 'migrations', 'sqlite'), { recursive: true });
        const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
        const script = `const t=Number(process.env.RACE_START);while(Date.now()<t){}\nimport('${path.join(root, 'services', 'sqliteService.ts').replace(/\\/g, '/')}').then(()=>process.exit(0)).catch(e=>{console.error(String(e&&e.message||e));process.exit(1)})`;

        const startAt = Date.now() + 2500; // all processes release together
        const run = () => new Promise<{ code: number | null; err: string }>((resolve) => {
            const p = spawn(tsx, ['-e', script], { cwd: tmp, env: { ...process.env, RACE_START: String(startAt), VITEST_WORKER_ID: undefined } as any });
            let err = '';
            p.stderr.on('data', d => { err += d.toString(); });
            p.on('close', code => resolve({ code, err }));
        });

        const results = await Promise.all(Array.from({ length: 16 }, run));
        for (const r of results) expect(r.err).not.toMatch(/UNIQUE constraint/);
        expect(results.map(r => r.code)).toEqual(Array(16).fill(0));

        const db = new Database(path.join(tmp, 'db', 'silhouette.sqlite'), { readonly: true });
        const rows = db.prepare('SELECT version, count(*) c FROM system_migrations GROUP BY version').all() as any[];
        db.close();
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(r.c).toBe(1);
        fs.rmSync(tmp, { recursive: true, force: true });
    }, 90000);
});
