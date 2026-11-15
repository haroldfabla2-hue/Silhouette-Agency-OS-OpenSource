import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
async function discover(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? discover(join(dir, entry.name))
        : Promise.resolve(/^verify_.*\.ts$/.test(entry.name) ? [join(dir, entry.name)] : [])));
    return nested.flat();
}
it('every manual TS verifier has an explicit reviewed CI disposition; new scripts cannot silently escape', async () => {
    const paths = (await Promise.all(['scripts', 'tests', 'tools/debug'].map(discover))).flat().sort();
    const manifest = JSON.parse(await readFile('tests/verification-manifest.json', 'utf8'));
    expect(manifest.scripts.map((entry: { path: string }) => entry.path).sort()).toEqual(paths);
    expect(new Set(manifest.scripts.map((entry: { path: string }) => entry.path)).size).toBe(paths.length);
    for (const entry of manifest.scripts) {
        expect(['ported', 'rewrite-required', 'isolated-runtime', 'service-required', 'runtime-review']).toContain(entry.status);
        expect(entry.reason.length).toBeGreaterThan(20);
    }
});
