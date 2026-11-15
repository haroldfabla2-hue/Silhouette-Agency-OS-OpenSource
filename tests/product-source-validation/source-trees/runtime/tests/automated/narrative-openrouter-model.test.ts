/**
 * Regression: narrativeService fell back to OpenRouter with the hardcoded
 * model "google/gemini-2.0-flash-exp:free", which OpenRouter RETIRED - every
 * fallback returned 404 (seen live in production logs) and narratives died
 * silently whenever the primary providers were unavailable.
 *
 * The fix routes the fallback through DEFAULT_OPENROUTER_MODEL, the single
 * source of truth whose header documents a live verification on 2026-10-13.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../services/narrativeService.ts'), 'utf-8');

describe('narrative OpenRouter fallback model (production 404 regression)', () => {
    it('no retired model literal remains in narrativeService', () => {
        expect(SRC).not.toContain('gemini-2.0-flash-exp');
    });

    it('the fallback uses the verified single source of truth', () => {
        expect(SRC).toContain("import { DEFAULT_OPENROUTER_MODEL } from './llm/defaultModels';");
        expect(SRC).toContain('model: DEFAULT_OPENROUTER_MODEL');
    });

    it('DEFAULT_OPENROUTER_MODEL is the live-verified free model', async () => {
        const { DEFAULT_OPENROUTER_MODEL } = await import('../../services/llm/defaultModels');
        expect(DEFAULT_OPENROUTER_MODEL).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    });
});
