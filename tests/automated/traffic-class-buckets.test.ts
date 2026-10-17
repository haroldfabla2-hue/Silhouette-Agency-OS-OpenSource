import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const cfo = readFileSync(join(ROOT, 'services', 'cfoService.ts'), 'utf8');
const gemini = readFileSync(join(ROOT, 'services', 'geminiService.ts'), 'utf8');

describe('PR-N: chat vs background Gemini buckets', () => {
    it('N1: CFO maps background traffic to the background bucket', () => {
        expect(cfo).toContain("context?.trafficClass === 'background'");
        expect(cfo).toContain('DEFAULT_GEMINI_BACKGROUND_MODEL');
        expect(cfo).toContain('return geminiDefault;');
        expect(cfo).not.toContain('return DEFAULT_GEMINI_MODEL;');
    });

    it('N2: generateAgentResponse seeds the background bucket and threads the class', () => {
        expect(gemini).toContain("trafficClass: 'background'");
        expect(gemini).toContain('modelOverride || DEFAULT_GEMINI_BACKGROUND_MODEL');
    });

    it('N3: modelOverride still wins in the background entry', () => {
        expect(gemini).toContain('let preferredModel = modelOverride ||');
    });
});
