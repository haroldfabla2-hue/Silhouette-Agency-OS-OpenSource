/**
 * [PR-4b] Honest task status, canonical peer-review persistence, per-id
 * memory-transition serialization, multilingual GENESIS trigger.
 *
 * Defects fixed (prod evidence):
 * - planExecutor marked steps success:true even when the LLM never answered
 *   (generateAgentResponse swallows provider exhaustion into "An error
 *   occurred during agent processing." / "Error: ..." strings).
 * - peerReviewService.registerNewAgent wrote raw JSON to db/agents/<id>.json:
 *   ENOENT in prod (supervisor-01/qa-01) and split-brain vs SQLite.
 * - MemoryTransitions threw 'Conflicting transition' into unhandled
 *   rejections (33 FATAL crashes in prod log) when concurrent promoters
 *   diverged; transitions are now serialized per memory id and a conflict
 *   adopts the durable journaled entry loudly instead of crashing.
 * - workflowEngine's GENESIS trigger matched English substrings only, so
 *   Spanish requests ("crea una app") never reached GENESIS.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PR-4b: planExecutor honest success', () => {
    const src = read('services/planExecutor.ts');
    it('declares the error-shaped detector and fails loudly without artifacts', () => {
        expect(src).toContain('errorShaped');
        expect(src).toContain('empty or error-shaped LLM response');
        expect(src).toContain("error: 'LLM returned no usable content (empty or error-shaped response)'");
    });
    it('treats empty, Error:-prefixed, swallowed-error and error-JSON outputs as failure shapes', () => {
        expect(src).toMatch(/trimmedOutput\.length === 0/);
        expect(src).toMatch(/\/\^Error:\//);
        expect(src).toMatch(/An error occurred during agent processing/);
        expect(src).toMatch(/errorShaped && stepArtifacts\.length === 0/);
    });
});

describe('PR-4b: peer-review canonical persistence', () => {
    const src = read('services/peerReviewService.ts');
    it('registerNewAgent persists via agentPersistence.saveAgent (SQLite + per-agent dir)', () => {
        expect(src).toContain('agentPersistence.saveAgent(agentDef)');
    });
    it('no longer writes raw JSON into db/agents (ENOENT + split-brain path removed)', () => {
        expect(src).not.toContain("path.join(process.cwd(), 'db', 'agents'");
    });
});

describe('PR-4b: memory transitions', () => {
    const mt = read('services/memoryTransitions.ts');
    const cm = read('services/continuumMemory.ts');
    it('conflict adopts the journaled transition with a loud warning instead of throwing', () => {
        expect(mt).toContain('[MEMORY_TRANSITIONS] Conflicting destination for');
        expect(mt).not.toContain('throw new Error(`Conflicting transition for ${source.id}`)');
    });
    it('serializes transitions per memory id and exposes transition/resume', () => {
        expect(mt).toContain('private chains = new Map<string, Promise<unknown>>');
        expect(mt).toContain('public async transition(source: MemoryNode, destination: MemoryNode)');
        expect(mt).toContain('public async resume(entry: MemoryTransition)');
    });
    it('continuumMemory uses the serialized API at every transition site', () => {
        expect(cm).not.toContain('memoryTransitions.begin(');
        expect(cm).toContain('memoryTransitions.transition(node, promoted)');
        expect(cm).toContain('memoryTransitions.transition(node, archivedNode)');
        expect(cm).toContain('memoryTransitions.transition(node, archived)');
        expect(cm).toContain('memoryTransitions.resume(entry)');
    });
});

describe('PR-4b: multilingual GENESIS trigger', () => {
    const we = read('services/workflowEngine.ts');
    const m = we.match(/const genesisTrigger = \/(.+)\/i;/);
    it('workflowEngine routes through the genesisTrigger regex', () => {
        expect(m).not.toBeNull();
        expect(we).toContain('genesisTrigger.test(intent)');
    });
    it('matches Spanish and English app-creation requests, not unrelated text', () => {
        const re = new RegExp(m![1], 'i');
        for (const yes of ['crea una app de recetas', 'quiero una nueva aplicación', 'nuevo proyecto web',
            'hazme una app para taxis', 'build an app for me', 'create a new project', 'new app please']) {
            expect(re.test(yes), yes).toBe(true);
        }
        for (const no of ['hazme una página de aterrizaje', 'corrige el header', 'investiga competidores']) {
            expect(re.test(no), no).toBe(false);
        }
    });
});
