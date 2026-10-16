import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const schema = readFileSync(join(ROOT, 'server', 'config', 'configSchema.ts'), 'utf8');
const configJson = readFileSync(join(ROOT, 'silhouette.config.json'), 'utf8');

describe('dead config cleanup (PR-H)', () => {
    it('sqlitePath/lanceDbPath removed from the memory config schema', () => {
        expect(schema).not.toContain('sqlitePath:');
        expect(schema).not.toContain('lanceDbPath:');
        expect(schema).toContain('nothing ever read them');
    });

    it('silhouette.config.json no longer carries the dead keys', () => {
        expect(configJson).not.toContain('"sqlitePath"');
        expect(configJson).not.toContain('"lanceDbPath"');
        expect(() => JSON.parse(configJson)).not.toThrow();
    });
});
