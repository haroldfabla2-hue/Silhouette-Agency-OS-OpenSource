/**
 * Source-audit: model ids must come from services/llm/defaultModels.ts,
 * never from literals pinned in call sites.
 *
 * Regression guard for the 2026-10-16 incident: the whole chat chain failed
 * because chatController pinned 'gemini-2.5-flash' (retired for new API keys)
 * and 'gemini-1.5-pro' / 'gemini-2.0-flash-exp' (removed from the API), and
 * the cognitive janitor pinned 'gemini-2.5-flash' too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const DEAD_OR_PINNED = /['"]gemini-\d|['"]gemini-1\.5|gpt-oss:20b|llama-3/;
const CALL_SITES = [
    'server/controllers/chatController.ts',
    'services/cognitive/cognitiveScheduler.ts',
];

describe('model id source-of-truth', () => {
    for (const site of CALL_SITES) {
        it(`${site} pins no model literal`, () => {
            const src = readFileSync(join(ROOT, site), 'utf8');
            const hits = src.split('\n')
                .filter(l => DEAD_OR_PINNED.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'));
            expect(hits, `model literals found: ${hits.join(' | ')}`).toHaveLength(0);
        });
    }

    it('defaultModels exports the chat model defaults', () => {
        const src = readFileSync(join(ROOT, 'services/llm/defaultModels.ts'), 'utf8');
        expect(src).toContain('export const DEFAULT_GEMINI_MODEL');
        expect(src).toContain('export const DEFAULT_GEMINI_PRO_MODEL');
        expect(src).toContain('export const DEFAULT_GEMINI_BACKGROUND_MODEL');
    });
});
