import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tokenize, lexicalScore, lexicalMatches } from '../../services/lexicalMatch';

// Regression: GET /v1/memory/search?q=Alberto+espanol returned 0 for the stored text
// "E2E Alberto prefiere espanol" because the whole query had to be one contiguous substring.

describe('lexicalMatch', () => {
    it('tokenizes ignoring case, accents and punctuation', () => {
        expect(tokenize('¡Alberto, PREFIERE español!')).toEqual(['alberto', 'prefiere', 'espanol']);
    });

    it('matches tokens in any order with words in between (the original miss)', () => {
        expect(lexicalMatches('E2E Alberto prefiere espanol', 'Alberto espanol')).toBe(true);
        expect(lexicalMatches('E2E Alberto prefiere espanol', 'espanol alberto')).toBe(true);
    });

    it('is accent and case insensitive in both directions', () => {
        expect(lexicalMatches('Alberto prefiere español', 'ESPANOL')).toBe(true);
        expect(lexicalMatches('Alberto prefiere espanol', 'español')).toBe(true);
    });

    it('NEGATIVE: a token that is absent means no match (no false positives)', () => {
        expect(lexicalMatches('E2E Alberto prefiere espanol', 'Alberto ingles')).toBe(false);
        expect(lexicalMatches('E2E Alberto prefiere espanol', 'zzz')).toBe(false);
        expect(lexicalScore('', 'alberto')).toBe(0);
        expect(lexicalScore('algo', '   ')).toBe(0);
        expect(lexicalScore('algo', '!!!')).toBe(0);
    });

    it('exact phrase and whole-word hits rank above scattered ones (no degradation of precise queries)', () => {
        const exact = lexicalScore('Alberto prefiere espanol', 'prefiere espanol');
        const scattered = lexicalScore('prefiere mucho el espanol', 'prefiere espanol');
        const partialWord = lexicalScore('prefierexyz espanolito', 'prefiere espanol');
        expect(exact).toBeGreaterThan(scattered);
        expect(scattered).toBeGreaterThan(partialWord);
        expect(partialWord).toBeGreaterThan(0);
    });

    it('the old contiguous-substring behaviour still matches (backward compatible)', () => {
        expect(lexicalMatches('E2E Alberto prefiere espanol', 'E2E')).toBe(true);
        expect(lexicalMatches('E2E Alberto prefiere espanol', 'alberto prefiere')).toBe(true);
    });
});

describe('memory search paths use the tokenized matcher (static guard; the real service import pulls the whole app and left a pending fetch at worker teardown in CI)', () => {
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');

    it('continuum RAM tier filters with lexicalMatches, not a whole-phrase includes()', () => {
        const src = read('services/continuumMemory.ts');
        expect(src).toMatch(/import \{ lexicalMatches, lexicalScore \} from '\.\/lexicalMatch'/);
        expect(src).toMatch(/this\.working\s*\n?\s*\.filter\(n => inScope\(n, scope\) && lexicalMatches\(/);
        expect(src).not.toMatch(/toLowerCase\(\)\.includes\(queryLower\)/);
    });

    it('qdrant text fallback uses lexicalMatches, not a whole-phrase includes()', () => {
        const src = read('services/vectorMemoryService.ts');
        expect(src).toMatch(/lexicalMatches\(p\.payload\?\.content \|\| '', query\)/);
        expect(src).not.toMatch(/toLowerCase\(\)\.includes\(query\.toLowerCase\(\)\)/);
    });
});
