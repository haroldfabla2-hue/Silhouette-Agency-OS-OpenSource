import { describe, it, expect } from 'vitest';
import fs from 'fs';

// FASE1 PR-B: the Continuum explorer called /v1/memory/* with a build-time
// Bearer key (empty in this build) and no session header, so search and
// CONSOLIDATE always failed 401 and the UI died silently. House rule: the
// shared api helper (x-session-id) is the only way views talk to the API.

const src = fs.readFileSync('components/ContinuumMemoryExplorer.tsx', 'utf8');

describe('continuum explorer uses session-authenticated api helper', () => {
    it('has no raw fetch with a build-time Bearer key', () => {
        expect(src).not.toContain('DEFAULT_API_CONFIG');
        expect(src).not.toMatch(/fetch\(`?\/v1\/memory/);
    });
    it('routes state, search, and consolidate through the api helper', () => {
        expect(src).toMatch(/api\.get\(`\/v1\/memory\/state\?limit=/); // paginated since feat/memory-pagination (was full dump every 2s)
        expect(src).toContain('api.get(`/v1/memory/search?q=');
        expect(src).toContain("api.post('/v1/memory/consolidate'");
    });
    it('surfaces search failures honestly instead of dying silently', () => {
        expect(src).toContain('searchError');
        expect(src).toContain('SEARCH UNAVAILABLE');
    });
});
