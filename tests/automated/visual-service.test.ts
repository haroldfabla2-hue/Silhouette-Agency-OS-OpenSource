/**
 * Visual Service — unit tests (CI has no PhotoCraft binary: tests cover the
 * honest-UNAVAILABLE contract and the pure validation layer).
 */
import { describe, it, expect } from 'vitest';
import { confinePath, visualService } from '../../services/visualService';

describe('confinePath', () => {
    const ROOT = '/opt/silhouette/workspace';

    it('accepts paths under the root', () => {
        expect(confinePath('/opt/silhouette/workspace/visual/a.png', ROOT)).toBe('/opt/silhouette/workspace/visual/a.png');
    });

    it('resolves dot segments that stay inside', () => {
        expect(confinePath('/opt/silhouette/workspace/visual/../visual/a.png', ROOT)).toBe('/opt/silhouette/workspace/visual/a.png');
    });

    it('rejects traversal escaping the root', () => {
        expect(() => confinePath('/opt/silhouette/workspace/../../etc/passwd', ROOT)).toThrow(/escapes/);
    });

    it('rejects absolute paths outside the root', () => {
        expect(() => confinePath('/etc/shadow', ROOT)).toThrow(/escapes/);
    });

    it('rejects empty paths', () => {
        expect(() => confinePath('', ROOT)).toThrow();
    });
});

describe('honest UNAVAILABLE (no engine binary in CI)', () => {
    it('isAvailable reflects the binary presence as a boolean', () => {
        expect(typeof visualService.isAvailable()).toBe('boolean');
    });

    it('compose never fakes output without the engine', async () => {
        if (visualService.isAvailable()) return; // host has the engine: skip
        const r = await visualService.compose({ width: 100, height: 100, out: '/opt/silhouette/output/visual/x.png' });
        expect(r.ok).toBe(false);
        expect(r.unavailable).toBe(true);
        expect(r.error).toMatch(/UNAVAILABLE/);
    });

    it('execute never fakes output without the engine', async () => {
        if (visualService.isAvailable()) return;
        const r = await visualService.execute({ command: 'type.create', newDoc: { width: 10, height: 10 } });
        expect(r.ok).toBe(false);
        expect(r.unavailable).toBe(true);
    });

    it('convert never fakes output without the engine', async () => {
        if (visualService.isAvailable()) return;
        const r = await visualService.convert('/opt/silhouette/workspace/a.png', '/opt/silhouette/output/visual/b.webp');
        expect(r.ok).toBe(false);
        expect(r.unavailable).toBe(true);
    });
});
