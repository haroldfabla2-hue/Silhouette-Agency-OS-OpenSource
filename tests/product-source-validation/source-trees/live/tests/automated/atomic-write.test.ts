import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { atomicWriteFile } from '../../services/utils/atomicWrite';

const dir = () => fs.mkdtemp(path.join(os.tmpdir(), 'aw-'));

describe('atomicWriteFile (regression: continuum snapshot fell back to a non-atomic copy)', () => {
    it('replaces the file and leaves no temp files', async () => {
        const d = await dir(); const f = path.join(d, 'snap.json');
        await atomicWriteFile(f, 'old'); await atomicWriteFile(f, 'new');
        expect(await fs.readFile(f, 'utf8')).toBe('new');
        expect((await fs.readdir(d))).toEqual(['snap.json']);
    });
    it('transient EPERM is retried and then succeeds', async () => {
        const d = await dir(); const f = path.join(d, 'snap.json');
        let n = 0;
        await atomicWriteFile(f, 'data', { retryDelayMs: 1, rename: async (a, b) => { if (n++ < 2) { const e: any = new Error('busy'); e.code = 'EPERM'; throw e; } await fs.rename(a, b); } });
        expect(await fs.readFile(f, 'utf8')).toBe('data'); expect(n).toBe(3);
    });
    it('persistent EPERM throws and the OLD content stays intact (no torn copy), temp cleaned', async () => {
        const d = await dir(); const f = path.join(d, 'snap.json');
        await fs.writeFile(f, 'old-complete');
        await expect(atomicWriteFile(f, 'new-content', { renameRetries: 2, retryDelayMs: 1, rename: async () => { const e: any = new Error('locked'); e.code = 'EBUSY'; throw e; } })).rejects.toThrow('locked');
        expect(await fs.readFile(f, 'utf8')).toBe('old-complete');
        expect(await fs.readdir(d)).toEqual(['snap.json']);
    });
    it('non-transient errors are not retried', async () => {
        const d = await dir(); let n = 0;
        await expect(atomicWriteFile(path.join(d, 'x'), 'a', { rename: async () => { n++; const e: any = new Error('nope'); e.code = 'ENOENT'; throw e; } })).rejects.toThrow('nope');
        expect(n).toBe(1);
    });
});
