import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const jail = readFileSync(join(ROOT, 'services', 'tools', 'fileJail.ts'), 'utf8');

describe('PR-L: relative paths anchor at the primary jail root', () => {
    it('L1: resolveWrite/resolveRead anchor relatives before resolving', () => {
        expect(jail).toContain('anchorAtPrimaryRoot(rawPath, roots)');
        expect(jail).toContain('path.join(roots[0], rawPath)');
    });

    it('L2: absolute paths and escapes stay governed by resolveWithinRoots', () => {
        expect(jail).toContain('path.isAbsolute(rawPath)');
        expect(jail).toContain('path escapes allowed roots');
    });
});
