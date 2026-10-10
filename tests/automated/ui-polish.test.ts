import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');

// Static guards: the real UI/controller sources must not regress.
const hardcodedVersion = (src: string) => /(?:OS|Agency OS)\s+[vV]\d+\.\d+/.test(src);

describe('UI polish guards', () => {
    it('detector control: flags a hardcoded version label', () => {
        expect(hardcodedVersion('AGENCY OS V4.0')).toBe(true);
        expect(hardcodedVersion('Agency OS v{APP_VERSION}')).toBe(false);
    });

    it('all version labels come from one source (package.json via vite define)', () => {
        for (const f of ['components/Sidebar.tsx', 'components/LocalLogin.tsx', 'components/ChatWidget.tsx']) {
            const src = read(f);
            expect(hardcodedVersion(src), f).toBe(false);
            expect(src, f).toContain('APP_VERSION');
        }
        expect(read('vite.config.ts')).toContain('__APP_VERSION__');
        expect(read('utils/appVersion.ts')).toContain('__APP_VERSION__');
    });

    it('Media Studio has no hardcoded demo brand (NIKE) and the server fallback is demo-mode only', () => {
        expect(read('components/MediaStudio.tsx')).not.toMatch(/nike/i);
        const ctl = read('server/controllers/mediaController.ts');
        expect(ctl).toContain('isDemoModeEnabled()');
        expect(ctl).toMatch(/status\(404\)[\s\S]{0,80}not found in memory/);
    });

    it('unreachable server is not confused with a login prompt (first-run setup stays reachable)', () => {
        const fp = read('utils/fingerprint.ts');
        expect(fp).toContain('serverUnreachable: true');
        const gate = read('components/LoginGate.tsx');
        expect(gate).toContain("type: 'unreachable'");
        expect(gate.indexOf('result.serverUnreachable')).toBeLessThan(gate.indexOf('result.needsSetup'));
    });

    it('.env.example documents SILHOUETTE_CORS_ORIGIN incl. Codespaces https origin', () => {
        const env = read('.env.example');
        expect(env).toContain('SILHOUETTE_CORS_ORIGIN=');
        expect(env).toContain('https://localhost:3000');
    });
});
