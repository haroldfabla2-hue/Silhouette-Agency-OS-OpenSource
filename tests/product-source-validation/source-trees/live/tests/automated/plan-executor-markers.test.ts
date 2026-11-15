import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const executor = readFileSync(join(ROOT, 'services', 'planExecutor.ts'), 'utf8');

describe('planExecutor tool-call extraction (PR-I)', () => {
    it('I1: [EXECUTE:] markers go through the shared balanced-brace scanner', () => {
        expect(executor).toContain('extractExecuteMarkers(text)');
        expect(executor).toContain("from './tools/execMarker'");
        expect(executor).not.toContain('executePattern');
    });

    it('I2: tool names are normalized (namespaced provider names resolve)', () => {
        expect(executor).toContain('normalizeToolName(marker.name)');
        expect(executor).toContain('normalizeToolName(match[1])');
    });

    it('I3: inner {error} payloads unwrap into honest failures', () => {
        expect(executor).toContain('capResult.success = false; capResult.error = innerError;');
    });
});
