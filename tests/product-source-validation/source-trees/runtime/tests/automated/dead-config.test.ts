import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const schema = readFileSync(join(ROOT, 'server', 'config', 'configSchema.ts'), 'utf8');
// The runtime config is private/ignored and must not be required by a clean checkout.
// Derive the test fixture strictly from the tracked public example. Its BOM is
// UTF-16LE today; decode explicitly, never substitute a green default object.
const exampleBytes = readFileSync(join(ROOT, 'silhouette.config.example.json'));
const configJson = (exampleBytes[0] === 0xff && exampleBytes[1] === 0xfe
    ? exampleBytes.subarray(2).toString('utf16le') : exampleBytes.toString('utf8')).replace(/^\uFEFF/, '');

describe('dead config cleanup (PR-H)', () => {
    it('sqlitePath/lanceDbPath removed from the memory config schema', () => {
        expect(schema).not.toContain('sqlitePath:');
        expect(schema).not.toContain('lanceDbPath:');
        expect(schema).toContain('nothing ever read them');
    });

    it('tracked config example used for private runtime configuration has no dead keys', () => {
        expect(configJson).not.toContain('"sqlitePath"');
        expect(configJson).not.toContain('"lanceDbPath"');
        expect(() => JSON.parse(configJson)).not.toThrow();
    });
});
