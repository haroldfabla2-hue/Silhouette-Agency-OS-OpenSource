import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ColdArchive } from '../../services/memory/coldArchive';
import { MemoryNode } from '../../types';

const NOW = 1_800_000_000_000;
const node = (over: Partial<MemoryNode>): MemoryNode => ({
    id: 'n1', content: 'recuerdo original completo sobre el proyecto Aurora', tags: [],
    importance: 0.8, accessCount: 3, timestamp: NOW, lastAccess: NOW, tier: 'MEDIUM', ...over
} as MemoryNode);

let dir: string;
let file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-')); file = path.join(dir, 'archive.jsonl'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('Cold archive (roadmap item 7, append-only second copy)', () => {
    it('appends a full original and recalls it verbatim', () => {
        const a = new ColdArchive({ enabled: true, filePath: file });
        const n = node({});
        expect(a.append(n, 'test')).toBe(true);
        const hits = a.recall('proyecto Aurora');
        expect(hits.length).toBe(1);
        expect(hits[0].node.content).toBe(n.content);   // FULL original, no summary
        expect(hits[0].node).toEqual(n);                 // every field preserved
    });

    it('is idempotent per node id (second copy, not a log)', () => {
        const a = new ColdArchive({ enabled: true, filePath: file });
        expect(a.append(node({}), 'first')).toBe(true);
        expect(a.append(node({}), 'again')).toBe(false);
        expect(a.stats().entries).toBe(1);
    });

    it('recall matches accent/case-insensitively and ranks by token overlap', () => {
        const a = new ColdArchive({ enabled: true, filePath: file });
        a.append(node({ id: 'x', content: 'La investigación cuántica avanzó rápidamente' }), 't');
        a.append(node({ id: 'y', content: 'la investigacion cuantica avanzo rapida y profundamente' }), 't');
        a.append(node({ id: 'z', content: 'receta de cocina italiana con tomate' }), 't');
        const hits = a.recall('investigación cuántica profundamente');
        expect(hits.map(h => h.node.id)).toEqual(['y', 'x']);   // more overlap first
        expect(hits.find(h => h.node.id === 'z')).toBeUndefined();
    });

    it('disabled archive writes nothing and recalls nothing', () => {
        const a = new ColdArchive({ enabled: false, filePath: file });
        expect(a.append(node({}), 't')).toBe(false);
        expect(a.recall('Aurora')).toEqual([]);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('stats report entries and time bounds', () => {
        const a = new ColdArchive({ enabled: true, filePath: file });
        a.append(node({ id: 'a' }), 't');
        a.append(node({ id: 'b' }), 't');
        const s = a.stats();
        expect(s.entries).toBe(2);
        expect(s.oldest).toBeGreaterThan(0);
        expect(s.newest).toBeGreaterThanOrEqual(s.oldest!);
    });

    it('janitor archives the ORIGINAL node when applying a supersede (second copy)', async () => {
        const archived: { node: MemoryNode; reason: string }[] = [];
        const { RevisionLedger } = await import('../../services/janitor/revisionLedger');
        const { JanitorService, loadConfig } = await import('../../services/janitor/janitorService');
        const store = new Map<string, MemoryNode>([
            ['n1', node({ id: 'n1', content: 'User likes coffee a lot' })],
            ['n2', node({ id: 'n2', content: 'User hates coffee now' })]
        ]);
        const REV = '{"action":"REV","confidence":0.92,"metaTruth":"User currently dislikes coffee","reason":"preference changed"}';
        const deps: any = {
            getCandidates: async () => [...store.values()],
            embed: async (t: string) => t.toLowerCase().includes('coffee') ? [1, 0] : [0, 1],
            upsertNode: async (n: MemoryNode) => { store.set(n.id, n); },
            getNodeById: async (id: string) => store.get(id) ?? null,
            detector: { judge: async () => ({ text: REV, provider: 'FAKE_A', model: 'a' }) },
            verifier: { judge: async () => ({ text: '{"agree":true,"reason":"ok"}', provider: 'FAKE_B', model: 'b' }) },
            ledger: new RevisionLedger(path.join(dir, 'ledger.jsonl')),
            archiveOriginal: async (n: MemoryNode, reason: string) => { archived.push({ node: n, reason }); },
            noteRevision: async () => {},
            now: () => NOW,
            newId: () => 'meta-1'
        };
        const svc = new JanitorService(deps, { ...loadConfig({}), dryRun: false });
        const report = await svc.runCycle();
        expect(report.applied).toBe(1);
        expect(archived.length).toBe(2);
        // the archived copy is the ORIGINAL (no SUPERSEDED tag yet), full content
        expect(archived.map(a => a.node.id).sort()).toEqual(['n1', 'n2']);
        expect(archived[0].node.tags).not.toContain('SUPERSEDED');
        expect(archived[0].reason).toContain('janitor:superseded-by:meta-1');
        expect(archived.find(a => a.node.id === 'n1')!.node.content).toBe('User likes coffee a lot');
    });
});
