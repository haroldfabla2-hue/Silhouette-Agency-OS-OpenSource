import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCycleStateOrPristine, parseCycleStore } from '../../services/selfdev/cycleStoreContinuity';

// Proposed real filesystem cases. No mocks. Not run under design-only admission.
describe('selfdev cycle continuity fail-closed admission', () => {
    function withDirectory(body: (dir: string) => void) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-continuity-'));
        try { body(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    it('allows pristine first start, including empty publisher directories', () => withDirectory(dir => {
        expect(readCycleStateOrPristine(dir)).toBeNull();
        fs.mkdirSync(path.join(dir, 'pr-requests')); fs.mkdirSync(path.join(dir, 'pr-results'));
        expect(readCycleStateOrPristine(dir)).toBeNull();
    }));
    it.each(['cycles.journal.jsonl', 'cycles.json.corrupt-1', '.selfcode-interrupted.tmp'])('blocks missing snapshot with %s evidence', name => withDirectory(dir => {
        fs.writeFileSync(path.join(dir, name), 'original evidence');
        expect(() => readCycleStateOrPristine(dir)).toThrow('SELFDEV_CONTINUITY_UNKNOWN');
        expect(fs.readFileSync(path.join(dir, name), 'utf8')).toBe('original evidence');
    }));
    it.each(['pr-requests', 'pr-results'])('blocks missing snapshot with existing %s handoff', name => withDirectory(dir => {
        fs.mkdirSync(path.join(dir, name)); fs.writeFileSync(path.join(dir, name, 'cycle.json'), '{}');
        expect(() => readCycleStateOrPristine(dir)).toThrow('SELFDEV_CONTINUITY_UNKNOWN');
    }));
    it('keeps malformed original bytes and blocks successive restart reads', () => withDirectory(dir => {
        const file = path.join(dir, 'cycles.json'); fs.writeFileSync(file, '{invalid');
        for (let restart = 0; restart < 2; restart++) {
            expect(() => parseCycleStore(readCycleStateOrPristine(dir)!)).toThrow();
            expect(fs.readFileSync(file, 'utf8')).toBe('{invalid');
            expect(fs.readdirSync(dir)).toEqual(['cycles.json']);
        }
    }));
    it('rejects cycle identity/state loss rather than accepting malformed entries', () => {
        for (const cycles of [[{}], [{ id: 'a', state: 'UNKNOWN' }], [null]]) {
            expect(() => parseCycleStore(JSON.stringify({ cycles }))).toThrow('SELFDEV_CONTINUITY_UNKNOWN');
        }
    });
    it('refuses a symlink snapshot without following or mutating its target', () => withDirectory(dir => {
        const target = path.join(dir, 'target'); fs.writeFileSync(target, '{"cycles":[]}');
        fs.symlinkSync(target, path.join(dir, 'cycles.json'));
        expect(() => readCycleStateOrPristine(dir)).toThrow('regular file');
        expect(fs.readFileSync(target, 'utf8')).toBe('{"cycles":[]}');
    }));
    it('preserves legacy minimal id plus known state without invented fields or dates', () => {
        const legacy = { cycles: [{ id: 'legacy-active', state: 'PLANNED' }, { id: 'legacy-done', state: 'ABANDONED' }] };
        expect(parseCycleStore(JSON.stringify(legacy))).toEqual(legacy);
    });
    it('retains valid active state byte-for-byte without calling execution', () => withDirectory(dir => {
        const cycle = { id: 'active', issue: 'real issue', state: 'ATTEMPTED', scope: ['services/memoryTransitions.ts'],
            history: [], runs: [], createdAt: '2026-11-15T20:00:00Z', updatedAt: '2026-11-15T20:00:00Z' };
        const bytes = JSON.stringify({ cycles: [cycle] }); fs.writeFileSync(path.join(dir, 'cycles.json'), bytes);
        expect(readCycleStateOrPristine(dir)).toBe(bytes);
        expect(parseCycleStore(bytes)).toEqual({ cycles: [cycle] });
    }));
});
