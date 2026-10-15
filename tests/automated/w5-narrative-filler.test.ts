import { describe, it, expect, beforeEach } from 'vitest';
import { fillerEnabled, minLlmImportance, routeThought } from '../../services/narrativeFillerPolicy';

describe('W5 narrative filler policy', () => {
    beforeEach(() => {
        delete process.env.SILHOUETTE_NARRATIVE_FILLER;
        delete process.env.SILHOUETTE_NARRATIVE_MIN_IMPORTANCE;
    });

    it('is OFF by default (the behavioral change Alberto must bless)', () => {
        expect(fillerEnabled()).toBe(false);
    });
    it('default threshold is 0.7 and ignores garbage env', () => {
        expect(minLlmImportance()).toBe(0.7);
        process.env.SILHOUETTE_NARRATIVE_MIN_IMPORTANCE = 'banana';
        expect(minLlmImportance()).toBe(0.7);
        process.env.SILHOUETTE_NARRATIVE_MIN_IMPORTANCE = '0';
        expect(minLlmImportance()).toBe(0.7);
        process.env.SILHOUETTE_NARRATIVE_MIN_IMPORTANCE = '0.85';
        expect(minLlmImportance()).toBe(0.85);
    });
    it('with filler OFF: system noise drops, only high importance reaches the LLM', () => {
        expect(routeThought(0.2)).toBe('DROP');   // legacy regex territory
        expect(routeThought(0.6)).toBe('DROP');   // the curiosity filler band
        expect(routeThought(0.7)).toBe('LLM');
        expect(routeThought(0.95)).toBe('LLM');
    });
    it('with filler ON: legacy routing preserved', () => {
        process.env.SILHOUETTE_NARRATIVE_FILLER = 'on';
        expect(fillerEnabled()).toBe(true);
        expect(routeThought(0.2)).toBe('REGEX');
        expect(routeThought(0.6)).toBe('LLM');
    });
});
