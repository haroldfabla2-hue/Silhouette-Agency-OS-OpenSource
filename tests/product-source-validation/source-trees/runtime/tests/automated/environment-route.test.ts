import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// F1 Environment Awareness: the service must be able to describe the
// environment it lives in (host, process, git identity, subsystem
// reachability, config presence) so agents can adapt to it.
// Hard rules baked into the design and guarded here:
// - READ-ONLY probes only.
// - NO SECRETS: config is presence booleans, never values.

const ROOT = path.resolve(__dirname, '..', '..');
const SVC = fs.readFileSync(path.join(ROOT, 'services/environmentService.ts'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'server/routes/v1/system.routes.ts'), 'utf8');

describe('F1 environment awareness', () => {
    it('GET /v1/system/environment is registered', () => {
        expect(ROUTES).toMatch(/router\.get\('\/environment'/);
        expect(ROUTES).toMatch(/environmentService\.getReport\(\)/);
    });

    it('the report covers host, process, git identity, subsystems, capabilities and config presence', () => {
        for (const field of ['host', 'process', 'service', 'subsystems', 'capabilities', 'config']) {
            expect(SVC).toMatch(new RegExp(`${field}:`));
        }
        expect(SVC).toMatch(/rev-parse/); // real git identity
        expect(SVC).toMatch(/tcpProbe/); // real reachability probes
    });

    it('probes the optional subsystems Alberto cares about (qdrant, ollama, local voice engine)', () => {
        expect(SVC).toMatch(/qdrant/);
        expect(SVC).toMatch(/ollama/);
        expect(SVC).toMatch(/voice-engine/);
    });

    it('never exposes secret values: config is presence booleans only', () => {
        // The config map must be built as booleans, and the returned report
        // object must not read raw env values (port is a number, config is boolean).
        expect(SVC).toMatch(/config\[key\] = Boolean\(process\.env\[key\]/);
        const marker = 'generatedAt: new Date().toISOString()';
        const report = SVC.slice(SVC.indexOf(marker));
        expect(report).not.toMatch(/process\.env\.[A-Z_]+/);
    });

    it('honest unknowns: gpu can be reported unknown, git fields can be null', () => {
        expect(SVC).toMatch(/'unknown'/);
        expect(SVC).toMatch(/dirty: dirtyOut === null \? null/);
    });
});
