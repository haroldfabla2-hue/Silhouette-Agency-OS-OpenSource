import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// R13 root fix (code legs): the persona forced fake omniscience ("You never
// guess. You know."), emergence rose on an idle system because quality
// initialized at 100, unmeasured responses fabricated an 85, the UI called a
// composite index "IIT", and prompts promised capabilities that may not exist
// ("NEVER go offline", "5-tier memory"). Pinned contracts: measured or
// declared, never invented. The final personality definition remains the
// user's decision; these are the honesty legs.

const ROOT = path.resolve(__dirname, '..', '..');

describe('R13 persona honesty (prompt contracts)', () => {
    it('no forced omniscience; groundedness with declared unknowns', () => {
        const src = fs.readFileSync(path.join(ROOT, 'constants/personalities.ts'), 'utf8');
        expect(src).not.toContain('Omniscient Agency Operating System');
        expect(src).not.toContain('You never guess. You know.');
        expect(src).toContain('Groundedness');
        expect(src).toContain('no lo sé');
        // style preserved (not a personality deletion)
        expect(src).toContain('Wit');
        expect(src).toContain('Hyper-Competent Executive Partner');
    });

    it('prompts never promise capabilities that may not exist', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server/controllers/chatController.ts'), 'utf8');
        expect(src).not.toContain('NEVER go offline');
        expect(src).not.toContain('5-tier memory system');
        expect(src).toContain('you ARE offline - say so honestly');
        const compiler = fs.readFileSync(path.join(ROOT, 'services/promptCompiler.ts'), 'utf8');
        expect(compiler).not.toContain('Omniscience, Loyalty, Confidence');
    });
});

describe('R13 emergence only from evaluated results', () => {
    it('workflow quality starts null (never evaluated), not 100', () => {
        const src = fs.readFileSync(path.join(ROOT, 'services/workflowEngine.ts'), 'utf8');
        expect(src).toContain('lastQualityScore: number | null = null');
        expect(src).not.toContain('lastQualityScore: number = 100');
        expect(src).not.toContain('response.qualityScore || 85');
    });

    it('detectEmergence is a no-op when nothing was evaluated', () => {
        const src = fs.readFileSync(path.join(ROOT, 'services/consciousnessEngine.ts'), 'utf8');
        expect(src).toContain('score === null');
        expect(src).toContain('idle proves nothing');
    });

    it('workflow routes expose whether the score was ever evaluated', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server/routes/v1/workflow.routes.ts'), 'utf8');
        expect(src).toContain('qualityScoreEvaluated');
    });
});

describe('R13 UI labels the composite index honestly', () => {
    it('no IIT claim; composite with components and limits', () => {
        const src = fs.readFileSync(path.join(ROOT, 'components/IntrospectionHub.tsx'), 'utf8');
        expect(src).not.toContain('Phi Score (IIT)');
        expect(src).not.toContain('Integrated Information Theory');
        expect(src).toContain('Cognitive Integration');
        expect(src).toContain('Composite index');
    });
});
