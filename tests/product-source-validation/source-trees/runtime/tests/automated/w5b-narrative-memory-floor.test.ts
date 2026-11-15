/**
 * [W5b] Memory floor: presentation and record are separate decisions.
 * Alberto's narrator vision (2026-10-14): interpretation -> memory ALWAYS,
 * narration aloud almost never. A thought whose narration is dropped must
 * still land raw in memory; only sub-floor heartbeat noise is dropped
 * entirely. Regression guard for the #134 partial break.
 *
 * Scope note (honest): these tests cover the policy decisions. The service
 * wiring (queueOrEmitThought's drop-branch calling persistNarrativeEvent)
 * is 10 lines reviewed by eye + verified live post-deploy; narrativeService
 * imports the whole runtime (redis, LLM stack) and is not unit-isolatable
 * without a mock lattice too brittle to be worth it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { memoryFloor, shouldRecord, routeThought } from '../../services/narrativeFillerPolicy';

describe('W5b memory floor policy', () => {
    beforeEach(() => {
        delete process.env.SILHOUETTE_NARRATIVE_MEMORY_FLOOR;
        delete process.env.SILHOUETTE_NARRATIVE_FILLER;
    });

    it('floor defaults to 0.3 and ignores garbage env', () => {
        expect(memoryFloor()).toBe(0.3);
        process.env.SILHOUETTE_NARRATIVE_MEMORY_FLOOR = 'banana';
        expect(memoryFloor()).toBe(0.3);
        process.env.SILHOUETTE_NARRATIVE_MEMORY_FLOOR = '0';
        expect(memoryFloor()).toBe(0.3);
        process.env.SILHOUETTE_NARRATIVE_MEMORY_FLOOR = '0.5';
        expect(memoryFloor()).toBe(0.5);
    });

    it('record band covers the whole presentation-drop band (floor..0.7)', () => {
        // filler OFF (default): narration drops below 0.7...
        expect(routeThought(0.3)).toBe('DROP');
        expect(routeThought(0.5)).toBe('DROP');
        expect(routeThought(0.69)).toBe('DROP');
        // ...but the record decision says KEEP for anything at/above the floor
        expect(shouldRecord(0.3)).toBe(true);
        expect(shouldRecord(0.5)).toBe(true);
        expect(shouldRecord(0.69)).toBe(true);
        // heartbeat noise below the floor: total drop (no voice, no record)
        expect(shouldRecord(0.1)).toBe(false);
        expect(shouldRecord(0.29)).toBe(false);
    });

    it('record decision is independent of the filler toggle', () => {
        process.env.SILHOUETTE_NARRATIVE_FILLER = 'on';
        expect(shouldRecord(0.5)).toBe(true);
        expect(shouldRecord(0.1)).toBe(false);
    });
});
