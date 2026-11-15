import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LipSyncService } from '../../services/media/lipSyncService';

describe('LipSyncService lazy output dir', () => {
    const dirs: string[] = [];
    const originalCwd = process.cwd();
    afterEach(() => {
        process.chdir(originalCwd);
        for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    it('constructs without creating the output dir, so read paths never depend on it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'lipsync-')); dirs.push(dir);
        process.chdir(dir);
        const service = new LipSyncService();
        expect(existsSync(join(dir, 'public/output/lipsync'))).toBe(false);
        expect(service).toBeDefined();
    });

    it('creates the output dir lazily when a write actually happens', () => {
        const dir = mkdtempSync(join(tmpdir(), 'lipsync-')); dirs.push(dir);
        process.chdir(dir);
        const service = new LipSyncService() as any;
        service.ensureOutputDir();
        expect(existsSync(join(dir, 'public/output/lipsync'))).toBe(true);
    });
});
