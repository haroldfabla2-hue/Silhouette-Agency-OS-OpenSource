/**
 * Identity evolution: versioning, audit ledger, guards, introspection path,
 * and the accumulated-evidence gate for soul adjustments.
 * Everything runs against tmp dirs — no external services, no LLM.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    createIdentityEvolution,
    replaceSection,
    diffSummary,
    IdentityEvolutionError,
    INTROSPECTION_GUARDS,
    MIN_EVIDENCE_SIGNALS,
    MIN_EVIDENCE_DAYS,
    EVIDENCE_WINDOW_DAYS,
    type IdentityIO,
    type IdentityFile,
    type IdentityEvidenceSource
} from '../../services/identity/identityEvolution';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';

const SOUL_V1 = `# Soul: TEST_AGENT

## Personality
I am a test agent.

## Core Values
- Honesty
- Transparency

## Communication Style
- Direct

## Principles
- Be reliable
`;

describe('identityEvolution', () => {
    let dir: string;
    let files: Map<string, string>;
    let io: IdentityIO;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-evolution-'));
        files = new Map();
        io = {
            read: (agentId: string, file: IdentityFile) => files.get(`${agentId}/${file}`) ?? '',
            write: (agentId: string, file: IdentityFile, content: string) => { files.set(`${agentId}/${file}`, content); },
            getAgentDir: () => dir
        };
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    /** Evidence source that always satisfies the gate (5 signals over 3 days). */
    const plentyEvidence: IdentityEvidenceSource = {
        async countSignals() { return { count: 5, distinctDays: 3 }; }
    };

    it('versions the first change with a snapshot of the previous content', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        const entry = evo.applyVersionedChange({
            agentId: 'a1', file: 'SOUL.md',
            newContent: SOUL_V1.replace('- Direct', '- Direct and warm'),
            rationale: 'Warm up the tone', appliedBy: 'updateSoul'
        });
        expect(entry.version).toBe(1);
        expect(entry.hashBefore).toBeTruthy();
        expect(entry.hashAfter).not.toBe(entry.hashBefore);
        expect(entry.snapshotPath).toBe('identity-history/SOUL.v1.md');
        expect(fs.readFileSync(path.join(dir, 'identity-history/SOUL.v1.md'), 'utf-8')).toBe(SOUL_V1);
        expect(files.get('a1/SOUL.md')).toContain('- Direct and warm');
    });

    it('increments versions per file independently and keeps the ledger append-only', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        files.set('a1/IDENTITY.md', '# Identity\n\n## Display Name\nTest\n');
        const evo = createIdentityEvolution(io);
        const e1 = evo.applyVersionedChange({ agentId: 'a1', file: 'SOUL.md', newContent: SOUL_V1 + '\nextra line\n', rationale: 'r1', appliedBy: 'test' });
        const e2 = evo.applyVersionedChange({ agentId: 'a1', file: 'IDENTITY.md', newContent: '# Identity\n\n## Display Name\nTest2\n', rationale: 'r2', appliedBy: 'test' });
        const e3 = evo.applyVersionedChange({ agentId: 'a1', file: 'SOUL.md', newContent: SOUL_V1 + '\nanother line\n', rationale: 'r3', appliedBy: 'test' });
        expect([e1.version, e2.version, e3.version]).toEqual([1, 1, 2]);
        const history = evo.getHistory('a1');
        expect(history).toHaveLength(3);
        const ledgerRaw = fs.readFileSync(path.join(dir, 'identity-ledger.jsonl'), 'utf-8').trim().split('\n');
        expect(ledgerRaw).toHaveLength(3);
        for (const line of ledgerRaw) expect(() => JSON.parse(line)).not.toThrow();
    });

    it('records rationale, source reflection and applier in the ledger and history file', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        evo.applyVersionedChange({
            agentId: 'a1', file: 'SOUL.md',
            newContent: SOUL_V1.replace('- Honesty', '- Honesty first'),
            rationale: 'Reflection on honesty', appliedBy: 'introspection:SOUL_ADJUST',
            sourceReflection: 'I noticed I value honesty above all'
        });
        const [entry] = evo.getHistory('a1');
        expect(entry.rationale).toBe('Reflection on honesty');
        expect(entry.sourceReflection).toBe('I noticed I value honesty above all');
        expect(entry.appliedBy).toBe('introspection:SOUL_ADJUST');
        const historyMd = fs.readFileSync(path.join(dir, 'IDENTITY_HISTORY.md'), 'utf-8');
        expect(historyMd).toContain('v1');
        expect(historyMd).toContain('Reflection on honesty');
        expect(historyMd).toContain('I noticed I value honesty above all');
    });

    it('rejects a no-op change', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        expect(() => evo.applyVersionedChange({
            agentId: 'a1', file: 'SOUL.md', newContent: SOUL_V1, rationale: 'x', appliedBy: 'test'
        })).toThrowError(IdentityEvolutionError);
    });

    it('requires rationale and appliedBy', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        expect(() => evo.applyVersionedChange({
            agentId: 'a1', file: 'SOUL.md', newContent: SOUL_V1 + 'x', rationale: ' ', appliedBy: 'test'
        })).toThrowError(/required/);
    });

    it('guard rejects losing a core marker', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        const withoutPersonality = SOUL_V1.replace('## Personality', '## Character');
        expect(() => evo.applyVersionedChange({
            agentId: 'a1', file: 'SOUL.md', newContent: withoutPersonality,
            rationale: 'rename section', appliedBy: 'introspection:SOUL_ADJUST', guard: INTROSPECTION_GUARDS
        })).toThrowError(/core markers/);
        expect(files.get('a1/SOUL.md')).toBe(SOUL_V1); // untouched
    });

    it('guard rejects changes touching too many sections', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        const rewritten = SOUL_V1
            .replace('- Honesty', '- Changed1')
            .replace('- Direct', '- Changed2')
            .replace('- Be reliable', '- Changed3');
        expect(() => evo.applyVersionedChange({
            agentId: 'a1', file: 'SOUL.md', newContent: rewritten,
            rationale: 'too broad', appliedBy: 'introspection:SOUL_ADJUST', guard: INTROSPECTION_GUARDS
        })).toThrowError(/sections/);
    });

    it('applyIntrospectionAdjustment replaces one section and records the source reflection', async () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io, { evidence: plentyEvidence });
        const outcome = await evo.applyIntrospectionAdjustment({
            agentId: 'a1',
            sectionHeading: '## Communication Style',
            newSectionContent: '## Communication Style\n- Direct\n- More patient with new users',
            rationale: 'Users asked for patience',
            sourceReflection: 'Several chats showed new users struggling',
            evidenceTopic: 'new users struggling'
        });
        if (outcome.status !== 'applied') throw new Error('expected applied');
        const entry = outcome.entry;
        expect(entry.appliedBy).toBe('introspection:SOUL_ADJUST');
        const updated = files.get('a1/SOUL.md')!;
        expect(updated).toContain('- More patient with new users');
        expect(updated).toContain('## Personality'); // core survives
        expect(updated).toContain('## Principles');
        expect(updated).not.toContain('patience\n- Direct'); // replaced, not duplicated
    });

    it('replaceSection throws on a missing section', () => {
        expect(() => replaceSection(SOUL_V1, '## Nonexistent', '## Nonexistent\nx')).toThrowError(IdentityEvolutionError);
    });

    it('diffSummary describes added sections and line deltas', () => {
        const after = SOUL_V1 + '\n## New Section\ncontent\n';
        const summary = diffSummary(SOUL_V1, after);
        expect(summary).toContain('sections added: ## New Section');
        expect(summary).toMatch(/lines \d+ → \d+/);
    });

    it('emits IDENTITY_EVOLVED on every applied change', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        const events: any[] = [];
        const handler = (p: any) => events.push(p);
        const unsubscribe = systemBus.subscribe(SystemProtocol.IDENTITY_EVOLVED, handler);
        try {
            evo.applyVersionedChange({
                agentId: 'a1', file: 'SOUL.md', newContent: SOUL_V1 + '\nmore\n',
                rationale: 'event test', appliedBy: 'test'
            });
        } finally {
            unsubscribe();
        }
        expect(events).toHaveLength(1);
        expect(events[0].payload.agentId).toBe('a1');
        expect(events[0].payload.version).toBe(1);
    });

    it('records the origin engine for engine-sourced adjustments', async () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io, { evidence: plentyEvidence });
        const outcome = await evo.applyIntrospectionAdjustment({
            agentId: 'a1',
            sectionHeading: '## Communication Style',
            newSectionContent: '## Communication Style\nWarmer, more curious.',
            rationale: 'Dream intuition: users engage more with questions than statements',
            sourceReflection: 'en un sueño noté que...',
            originEngine: 'dreamer',
            evidenceTopic: 'questions engagement'
        });
        if (outcome.status !== 'applied') throw new Error('expected applied');
        const entry = outcome.entry;
        expect(entry.appliedBy).toBe('introspection:SOUL_ADJUST:dreamer');
        const history = evo.getHistory('a1');
        expect(history[history.length - 1].appliedBy).toBe('introspection:SOUL_ADJUST:dreamer');
    });

    it('defaults originEngine to reflection for plain introspection adjustments', async () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io, { evidence: plentyEvidence });
        const outcome = await evo.applyIntrospectionAdjustment({
            agentId: 'a1',
            sectionHeading: '## Communication Style',
            newSectionContent: '## Communication Style\nMore concise.',
            rationale: 'reflection-driven tweak',
            sourceReflection: 'thought',
            evidenceTopic: 'concise answers'
        });
        if (outcome.status !== 'applied') throw new Error('expected applied');
        expect(outcome.entry.appliedBy).toBe('introspection:SOUL_ADJUST');
    });

    it('rate-limits engine-sourced adjustments per day but never reflection ones', async () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io, { evidence: plentyEvidence });
        const engines = ['dreamer', 'curiosity', 'research'] as const;
        // 3 engine-sourced adjustments (the daily cap) all apply
        for (const [i, engine] of engines.entries()) {
            const current = files.get('a1/SOUL.md')!;
            const outcome = await evo.applyIntrospectionAdjustment({
                agentId: 'a1',
                sectionHeading: '## Communication Style',
                newSectionContent: `## Communication Style\nEngine tweak ${i}.`,
                rationale: `${engine} evidence ${i}`,
                sourceReflection: 'engine thought',
                originEngine: engine,
                evidenceTopic: `pattern ${i}`
            });
            expect(outcome.status).toBe('applied');
            expect(files.get('a1/SOUL.md')).not.toBe(current);
        }
        // The 4th engine-sourced adjustment today is rejected
        await expect(evo.applyIntrospectionAdjustment({
            agentId: 'a1',
            sectionHeading: '## Communication Style',
            newSectionContent: '## Communication Style\nOne too many.',
            rationale: 'dreamer evidence overflow',
            sourceReflection: 'engine thought',
            originEngine: 'dreamer',
            evidenceTopic: 'overflow pattern'
        })).rejects.toThrowError(IdentityEvolutionError);
        // A reflection-sourced adjustment still applies: the cap guards engines only
        const outcome = await evo.applyIntrospectionAdjustment({
            agentId: 'a1',
            sectionHeading: '## Communication Style',
            newSectionContent: '## Communication Style\nReflection still flows.',
            rationale: 'reflection-driven tweak',
            sourceReflection: 'thought',
            evidenceTopic: 'reflection pattern'
        });
        if (outcome.status !== 'applied') throw new Error('expected applied');
        expect(outcome.entry.appliedBy).toBe('introspection:SOUL_ADJUST');
    });

    it('rejects an unknown originEngine', async () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io, { evidence: plentyEvidence });
        await expect(evo.applyIntrospectionAdjustment({
            agentId: 'a1',
            sectionHeading: '## Communication Style',
            newSectionContent: '## Communication Style\nX.',
            rationale: 'r',
            sourceReflection: 't',
            evidenceTopic: 'x',
            originEngine: 'oracle' as any
        })).rejects.toThrowError(IdentityEvolutionError);
    });
});

describe('identity evolution evidence gate', () => {
    let dir: string;
    let files: Map<string, string>;
    let io: IdentityIO;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-gate-'));
        files = new Map();
        files.set('a1/SOUL.md', SOUL_V1);
        io = {
            read: (agentId: string, file: IdentityFile) => files.get(`${agentId}/${file}`) ?? '',
            write: (agentId: string, file: IdentityFile, content: string) => { files.set(`${agentId}/${file}`, content); },
            getAgentDir: () => dir
        };
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const baseParams = {
        agentId: 'a1',
        sectionHeading: '## Communication Style',
        newSectionContent: '## Communication Style\n- Direct\n- More patient',
        rationale: 'Users keep disengaging from terse answers',
        sourceReflection: 'me di cuenta de que mis respuestas secas alejan usuarios',
        evidenceTopic: 'terse answers'
    };

    it('parks a proposal backed by a single reflection (no accumulated evidence)', async () => {
        const evo = createIdentityEvolution(io, {
            evidence: { async countSignals() { return { count: 1, distinctDays: 1 }; } }
        });
        const events: any[] = [];
        const handler = (p: any) => events.push(p);
        const unsubscribe = systemBus.subscribe(SystemProtocol.IDENTITY_ADJUSTMENT_PENDING, handler);
        try {
            const outcome = await evo.applyIntrospectionAdjustment(baseParams);
            expect(outcome.status).toBe('pending');
            // No identity change happened
            expect(files.get('a1/SOUL.md')).toBe(SOUL_V1);
            expect(evo.getHistory('a1')).toHaveLength(0);
            // The proposal is parked and visible
            const pending = evo.getPendingAdjustments('a1');
            expect(pending).toHaveLength(1);
            expect(pending[0].evidenceTopic).toBe('terse answers');
            expect(pending[0].evidenceWhenParked).toEqual({ count: 1, distinctDays: 1 });
            // The parking is announced on the bus
            expect(events).toHaveLength(1);
            expect(events[0].payload.evidenceTopic).toBe('terse answers');
        } finally {
            unsubscribe();
        }
    });

    it('requires signals over multiple distinct days, not a same-day burst', async () => {
        const evo = createIdentityEvolution(io, {
            evidence: { async countSignals() { return { count: 9, distinctDays: 1 }; } }
        });
        const outcome = await evo.applyIntrospectionAdjustment(baseParams);
        expect(outcome.status).toBe('pending');
        expect(files.get('a1/SOUL.md')).toBe(SOUL_V1);
    });

    it('requires a minimum number of signals even across days', async () => {
        const evo = createIdentityEvolution(io, {
            evidence: { async countSignals() { return { count: MIN_EVIDENCE_SIGNALS - 1, distinctDays: 4 }; } }
        });
        const outcome = await evo.applyIntrospectionAdjustment(baseParams);
        expect(outcome.status).toBe('pending');
    });

    it('applies once the threshold is met: count >= minimum AND days >= minimum', async () => {
        const evo = createIdentityEvolution(io, {
            evidence: { async countSignals() { return { count: MIN_EVIDENCE_SIGNALS, distinctDays: MIN_EVIDENCE_DAYS }; } }
        });
        const outcome = await evo.applyIntrospectionAdjustment(baseParams);
        expect(outcome.status).toBe('applied');
        expect(files.get('a1/SOUL.md')).toContain('- More patient');
        expect(evo.getPendingAdjustments('a1')).toHaveLength(0);
    });

    it('a parked proposal matures via reevaluation once evidence accumulates', async () => {
        let signals = { count: 1, distinctDays: 1 };
        const evo = createIdentityEvolution(io, {
            evidence: { async countSignals() { return signals; } }
        });
        const first = await evo.applyIntrospectionAdjustment(baseParams);
        expect(first.status).toBe('pending');

        // First reevaluation: still not enough evidence
        const early = await evo.reevaluatePendingAdjustments('a1');
        expect(early.applied).toHaveLength(0);
        expect(early.stillPending).toBe(1);
        expect(files.get('a1/SOUL.md')).toBe(SOUL_V1);

        // Evidence accumulates over the following days; the next cycles apply it
        signals = { count: 4, distinctDays: 3 };
        const later = await evo.reevaluatePendingAdjustments('a1');
        expect(later.applied).toHaveLength(1);
        expect(later.stillPending).toBe(0);
        expect(files.get('a1/SOUL.md')).toContain('- More patient');
        // The matured change lands in the same auditable ledger, citing the accumulation
        const history = evo.getHistory('a1');
        expect(history).toHaveLength(1);
        expect(history[0].rationale).toContain('evidence accumulated: 4 signals over 3 days');
        // And the pending log records the maturation (append-only statuses)
        expect(evo.getPendingAdjustments('a1')).toHaveLength(0);
    });

    it('asks the evidence source for signals inside the configured window', async () => {
        const seen: { topic?: string; sinceMs?: number } = {};
        const evo = createIdentityEvolution(io, {
            evidence: {
                async countSignals(_agentId: string, topic: string, sinceMs: number) {
                    seen.topic = topic; seen.sinceMs = sinceMs;
                    return { count: 0, distinctDays: 0 };
                }
            }
        });
        await evo.applyIntrospectionAdjustment(baseParams);
        expect(seen.topic).toBe('terse answers');
        const windowMs = EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        expect(Date.now() - (seen.sinceMs ?? 0)).toBeGreaterThanOrEqual(windowMs - 1000);
        expect(Date.now() - (seen.sinceMs ?? 0)).toBeLessThan(windowMs + 60_000);
    });

    it('without a wired evidence source, evidence is honestly zero (proposal parks, never mocks)', async () => {
        const evo = createIdentityEvolution(io); // no evidence source injected
        const outcome = await evo.applyIntrospectionAdjustment(baseParams);
        expect(outcome.status).toBe('pending');
        if (outcome.status !== 'pending') throw new Error('expected pending');
        expect(outcome.pending.evidenceWhenParked).toEqual({ count: 0, distinctDays: 0 });
    });

    it('rejects a proposal without an evidenceTopic', async () => {
        const evo = createIdentityEvolution(io);
        await expect(evo.applyIntrospectionAdjustment({ ...baseParams, evidenceTopic: '' }))
            .rejects.toThrowError(/evidenceTopic/);
    });

    it('the rate limit still guards engine-sourced proposals maturing from the pending log', async () => {
        // Preload today's ledger with the engine cap (3 applied engine adjustments)
        const plenty = { async countSignals() { return { count: 8, distinctDays: 5 }; } };
        const evo = createIdentityEvolution(io, { evidence: plenty });
        const engines = ['dreamer', 'curiosity', 'research'] as const;
        for (const [i, engine] of engines.entries()) {
            const outcome = await evo.applyIntrospectionAdjustment({
                ...baseParams,
                newSectionContent: `## Communication Style\nEngine tweak ${i}.`,
                rationale: `${engine} evidence ${i}`,
                originEngine: engine,
                evidenceTopic: `engine pattern ${i}`
            });
            expect(outcome.status).toBe('applied');
        }
        // Park a 4th engine proposal by starving it of evidence once…
        const starving = createIdentityEvolution(io, {
            evidence: { async countSignals() { return { count: 0, distinctDays: 0 }; } }
        });
        const parked = await starving.applyIntrospectionAdjustment({
            ...baseParams,
            newSectionContent: '## Communication Style\nFourth engine tweak.',
            rationale: 'dreamer sees yet another pattern',
            originEngine: 'dreamer',
            evidenceTopic: 'fourth pattern'
        });
        expect(parked.status).toBe('pending');
        // …then feed it enough evidence: reevaluation must still respect the daily engine cap
        const reeval = await evo.reevaluatePendingAdjustments('a1');
        expect(reeval.applied).toHaveLength(0);
        expect(reeval.stillPending).toBe(1);
        expect(files.get('a1/SOUL.md')).not.toContain('Fourth engine tweak');
    });
});
