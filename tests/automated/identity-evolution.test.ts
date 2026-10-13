/**
 * Identity evolution: versioning, audit ledger, guards, introspection path.
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
    type IdentityIO,
    type IdentityFile
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

    it('applyIntrospectionAdjustment replaces one section and records the source reflection', () => {
        files.set('a1/SOUL.md', SOUL_V1);
        const evo = createIdentityEvolution(io);
        const entry = evo.applyIntrospectionAdjustment({
            agentId: 'a1',
            sectionHeading: '## Communication Style',
            newSectionContent: '## Communication Style\n- Direct\n- More patient with new users',
            rationale: 'Users asked for patience',
            sourceReflection: 'Several chats showed new users struggling'
        });
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
});
