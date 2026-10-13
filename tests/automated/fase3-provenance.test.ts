/**
 * FASE 3: Memory provenance + first-person introspection — REAL behavioral tests.
 *
 * Verifies the user requirement: introspection is the entity narrating ITS OWN
 * thoughts ("me está doliendo la pierna"), and it must never be confused with
 * what the user said or with what other agents report.
 *
 * - Every write carries a reserved source:* tag; attribution reads the field,
 *   not a content/tag guess.
 * - Chat context excludes the entity's own raw voice by default (ASSISTANT_SAID,
 *   INTROSPECTION) with explicit opt-in; curated facts stay, labeled.
 * - Facts stated by the user (USER_STATED) are distinguished from facts inferred
 *   from the assistant's own words (USER_INFERRED, confidence-capped).
 * - The narrator's epiphany prompt demands first-person introspection.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    MemorySource, sourceTag, agentSourceTag, parseSource,
    isSelfGenerated, shouldExcludeFromChat, wantsSelfIncluded, speakerLabel
} from '../../services/memory/provenance';
import { FactExtractionService } from '../../services/factExtractor';
import { continuum } from '../../services/continuumMemory';
import { MemoryTier } from '../../types';

describe('provenance vocabulary and attribution', () => {
    it('sourceTag/parseSource round-trip, including agent names', () => {
        expect(sourceTag(MemorySource.USER_SAID)).toBe('source:USER_SAID');
        expect(parseSource([sourceTag(MemorySource.INTROSPECTION)])).toBe('INTROSPECTION');
        expect(parseSource([agentSourceTag('narrator')])).toBe('AGENT:narrator');
        expect(parseSource(['chat', 'interaction'])).toBeNull();
        expect(parseSource(undefined)).toBeNull();
    });

    it('speakerLabel attributes by source field, never by content', () => {
        expect(speakerLabel([sourceTag(MemorySource.USER_SAID)])).toBe('USER said');
        expect(speakerLabel([sourceTag(MemorySource.ASSISTANT_SAID)])).toBe('ASSISTANT said');
        expect(speakerLabel([sourceTag(MemorySource.INTROSPECTION)])).toBe('SILHOUETTE thought (introspection)');
        expect(speakerLabel([agentSourceTag('researcher')])).toBe('Agent researcher reported');
        expect(speakerLabel([sourceTag(MemorySource.SYSTEM)])).toBe('System recorded');
        // Legacy fallback for pre-provenance entries
        expect(speakerLabel(['USER_MESSAGE', 'CHAT'])).toBe('USER said');
        expect(speakerLabel(['epiphany'])).toBe('Memory');
    });

    it('inferred user facts are labeled as inference, never as user speech', () => {
        expect(speakerLabel(['user_fact', 'USER_INFERRED', sourceTag(MemorySource.INTROSPECTION)])).toBe('Silhouette inferred (unverified)');
        expect(speakerLabel(['FACT', 'USER_STATED', sourceTag(MemorySource.USER_SAID)])).toBe('USER said');
    });
});

describe('chat-context exclusion of the entity\'s own voice', () => {
    it('excludes ASSISTANT_SAID and INTROSPECTION raw content by default', () => {
        expect(isSelfGenerated(['USER', 'CHAT', 'ASSISTANT_RESPONSE', sourceTag(MemorySource.ASSISTANT_SAID)])).toBe(true);
        expect(isSelfGenerated(['epiphany', 'consciousness', sourceTag(MemorySource.INTROSPECTION)])).toBe(true);
        expect(shouldExcludeFromChat(['epiphany', sourceTag(MemorySource.INTROSPECTION)], false)).toBe(true);
    });

    it('keeps user speech, system records, other agents, and curated facts', () => {
        expect(shouldExcludeFromChat(['USER_MESSAGE', sourceTag(MemorySource.USER_SAID)], false)).toBe(false);
        expect(shouldExcludeFromChat(['log', sourceTag(MemorySource.SYSTEM)], false)).toBe(false);
        expect(shouldExcludeFromChat([agentSourceTag('researcher')], false)).toBe(false);
        // Curated facts are not excluded: they carry their own stated/inferred label
        expect(shouldExcludeFromChat(['FACT', 'USER_INFERRED', sourceTag(MemorySource.ASSISTANT_SAID)], false)).toBe(false);
        expect(shouldExcludeFromChat(['user_fact', 'USER_INFERRED', sourceTag(MemorySource.INTROSPECTION)], false)).toBe(false);
    });

    it('opt-in: asking about the entity\'s own words re-includes self content', () => {
        expect(wantsSelfIncluded('¿qué te dijiste ayer?')).toBe(true);
        expect(wantsSelfIncluded('what did you think about that?')).toBe(true);
        expect(wantsSelfIncluded('muéstrame tus pensamientos')).toBe(true);
        expect(wantsSelfIncluded('hola, ¿cómo estás?')).toBe(false);
        expect(shouldExcludeFromChat(['epiphany', sourceTag(MemorySource.INTROSPECTION)], true)).toBe(false);
    });
});

describe('factExtractor: USER_STATED vs USER_INFERRED', () => {
    it('maps the LLM per-fact source and caps inference confidence', () => {
        const extractor = new FactExtractionService();
        const parse = (extractor as any).parseFactsResponse.bind(extractor);
        const facts = parse(JSON.stringify([
            { type: 'PERSONAL', content: 'The user name is Alberto', confidence: 0.95, source: 'user' },
            { type: 'PREFERENCE', content: 'The user might like sushi', confidence: 0.95, source: 'assistant' },
            { type: 'FACT', content: 'The user has a dog', confidence: 0.8 }
        ]));
        expect(facts).toHaveLength(3);
        expect(facts[0].source).toBe('USER_STATED');
        expect(facts[0].confidence).toBe(0.95);            // stated keeps confidence
        expect(facts[1].source).toBe('USER_INFERRED');
        expect(facts[1].confidence).toBeLessThanOrEqual(0.6); // inferred is capped
        expect(facts[2].source).toBe('USER_STATED');          // missing source defaults to stated
    });
});

describe('continuum round-trip: provenance survives storage and retrieval', () => {
    it('an introspection entry round-trips with its source tag and is excluded from chat context', async () => {
        const marker = `introspection-rt-${Date.now()}`;
        await continuum.store(
            `EPIPHANY [REFLECTION|REFLECT]: ${marker} me pica la nariz pensando en esto`,
            MemoryTier.WORKING,
            ['epiphany', 'consciousness', 'reflection', sourceTag(MemorySource.INTROSPECTION)],
            true
        );
        const results = await continuum.retrieve(marker, undefined, undefined);
        const mine = results.find(m => m.content.includes(marker));
        expect(mine).toBeDefined();
        expect(parseSource(mine!.tags)).toBe('INTROSPECTION');
        expect(shouldExcludeFromChat(mine!.tags, false)).toBe(true);
        expect(speakerLabel(mine!.tags)).toBe('SILHOUETTE thought (introspection)');
    }, 30000);

    it('a user message round-trips as USER_SAID and stays visible', async () => {
        const marker = `user-said-rt-${Date.now()}`;
        await continuum.store(
            `${marker} me llamo Alberto y prefiero respuestas directas`,
            MemoryTier.WORKING,
            ['USER', 'CHAT', 'USER_MESSAGE', sourceTag(MemorySource.USER_SAID)],
            true
        );
        const results = await continuum.retrieve(marker, undefined, undefined);
        const mine = results.find(m => m.content.includes(marker));
        expect(mine).toBeDefined();
        expect(parseSource(mine!.tags)).toBe('USER_SAID');
        expect(shouldExcludeFromChat(mine!.tags, false)).toBe(false);
        expect(speakerLabel(mine!.tags)).toBe('USER said');
    }, 30000);
});

describe('source contracts hold', () => {
    const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

    it('the narrator epiphany prompt demands first-person introspection', () => {
        const src = read('services/cognitive/thoughtNarrator.ts');
        expect(src).toContain('FIRST PERSON');
        expect(src).toContain('introspection');
        expect(src).toContain('NEVER confuse your own thoughts with things the user said');
    });

    it('every narrator continuum write carries a source tag', () => {
        const src = read('services/cognitive/thoughtNarrator.ts');
        const stores = src.match(/continuum\.store\([\s\S]*?\);/g) || [];
        expect(stores.length).toBeGreaterThan(0);
        for (const call of stores) {
            expect(call).toContain('sourceTag(');
        }
    });

    it('narrator-inferred user facts are labeled USER_INFERRED, never USER_STATED', () => {
        const src = read('services/cognitive/thoughtNarrator.ts');
        expect(src).toContain("source: 'USER_INFERRED'");
        expect(src).toContain("'USER_INFERRED'");
        expect(src).not.toContain("source: 'consciousness'");
    });

    it('chat writes carry provenance on both voices', () => {
        const src = read('server/controllers/chatController.ts');
        expect(src).toContain(`sourceTag(MemorySource.USER_SAID)`);
        expect(src).toContain(`sourceTag(MemorySource.ASSISTANT_SAID)`);
    });

    it('chat context attributes by provenance field, not the old tag heuristic', () => {
        const src = read('server/controllers/chatController.ts');
        expect(src).toContain('speakerLabel(m.tags)');
        expect(src).toContain('shouldExcludeFromChat');
        expect(src).not.toContain("const speaker = m.tags");
    });

    it('graph getUserFacts surfaces per-fact source', () => {
        const src = read('services/graphService.ts');
        expect(src).toContain("coalesce(f.source, 'LEGACY') as source");
    });
});
