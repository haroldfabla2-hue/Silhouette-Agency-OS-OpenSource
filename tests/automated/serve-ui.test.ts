/** Static-serving gate: the UI must be served in the real deployment. */
import { describe, it, expect } from 'vitest';
import { shouldServeUi } from '../../server/config/staticServing';

describe('shouldServeUi', () => {
    it('serves when SERVE_UI=true, whatever the rest says', () => {
        expect(shouldServeUi({ SERVE_UI: 'true', NODE_ENV: 'development' }, false)).toBe(true);
    });
    it('SERVE_UI=false wins over production and a present build', () => {
        expect(shouldServeUi({ SERVE_UI: 'false', NODE_ENV: 'production' }, true)).toBe(false);
    });
    it('production serves even without a build (legacy behavior)', () => {
        expect(shouldServeUi({ NODE_ENV: 'production' }, false)).toBe(true);
    });
    it('[the live bug] development WITH a built dist serves (was the 404)', () => {
        expect(shouldServeUi({ NODE_ENV: 'development' }, true)).toBe(true);
    });
    it('development without a build stays API-only (vite dev flow intact)', () => {
        expect(shouldServeUi({ NODE_ENV: 'development' }, false)).toBe(false);
        expect(shouldServeUi({}, false)).toBe(false);
    });
    it('empty SERVE_UI falls through to defaults', () => {
        expect(shouldServeUi({ SERVE_UI: '', NODE_ENV: 'production' }, false)).toBe(true);
    });
});
