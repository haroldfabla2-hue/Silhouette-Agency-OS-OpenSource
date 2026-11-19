import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { NarrativePendingStore, type PendingNarration } from '../../services/narrativePendingStore';

const fixture: PendingNarration[] = [
    { id: 'fixture-a', source: 'CONSCIOUS', content: 'Public original work A', importance: 0.9, metadata: { sequence: 1 } },
    { id: 'fixture-b', source: 'AGENCY', content: 'Public original work B', importance: 0.8 }
];
describe('narrative pending journal, real filesystem only', () => {
    it('recovers pending originals across reopen and acknowledges original plus provider result atomically', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-journal-'));
        try {
            const first = new NarrativePendingStore(dir);
            first.save(fixture);
            const reopened = new NarrativePendingStore(dir);
            expect(reopened.load()).toEqual(fixture);
            // Storage contract fixture, not a provider simulation: these strings
            // exercise durable acknowledgment, never generated or emitted text.
            reopened.complete([fixture[0]], ['Public fixture output A'], [fixture[1]]);
            const next = new NarrativePendingStore(dir);
            expect(next.load()).toEqual([fixture[1]]);
            const disk = JSON.parse(fs.readFileSync(next.file, 'utf8'));
            expect(disk.completed).toEqual([{ item: fixture[0], narrated: 'Public fixture output A' }]);
            if (process.platform !== 'win32') expect(fs.statSync(next.file).mode & 0o777).toBe(0o600);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
    it('refuses a second real process before it can overwrite another owner', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-journal-owner-'));
        try {
            const owner = new NarrativePendingStore(dir);
            owner.save(fixture);
            const before = fs.readFileSync(owner.file);
            const loader = pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href;
            const moduleUrl = pathToFileURL(path.resolve('services/narrativePendingStore.ts')).href;
            const program = `import { NarrativePendingStore } from ${JSON.stringify(moduleUrl)};
                const other = new NarrativePendingStore(process.argv[1]);
                try { other.save([]); throw new Error('SECOND_OWNER_WROTE'); }
                catch (error) { if (error.message !== 'NARRATIVE_OWNER_UNAVAILABLE') throw error; }
                console.log('owner-refused');`;
            const result = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', program, dir], {
                encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, NODE_ENV: 'test' }
            });
            expect(result.error).toBeUndefined();
            expect(result.status).toBe(0);
            expect(result.stdout.trim()).toBe('owner-refused');
            expect(fs.readFileSync(owner.file)).toEqual(before);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
    it('rejects unserializable metadata without changing acknowledged original bytes', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-journal-invalid-'));
        try {
            const store = new NarrativePendingStore(dir);
            store.save(fixture);
            const before = fs.readFileSync(store.file);
            const cycle: any = {}; cycle.self = cycle;
            for (const metadata of [cycle, { fn: () => 1 }, { missing: undefined }, { number: NaN }, new Date()]) {
                expect(() => store.save([{ ...fixture[0], metadata }])).toThrow();
                expect(fs.readFileSync(store.file)).toEqual(before);
            }
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
    it('fails on genuine storage obstruction and preserves malformed prior bytes', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-journal-obstructed-'));
        try {
            const blocked = path.join(dir, 'not-directory');
            fs.writeFileSync(blocked, 'owned obstruction');
            const store = new NarrativePendingStore(blocked);
            expect(() => store.save(fixture)).toThrow();
            expect(fs.readFileSync(blocked, 'utf8')).toBe('owned obstruction');
            const malformed = new NarrativePendingStore(dir);
            fs.writeFileSync(malformed.file, '{original broken journal');
            expect(() => malformed.load()).toThrow();
            expect(fs.readFileSync(malformed.file, 'utf8')).toBe('{original broken journal');
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
