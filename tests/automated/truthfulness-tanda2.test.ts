/**
 * Tanda 2 truthfulness remediation tests.
 *
 * Guards against re-introducing fabricated internal successes:
 *  A5 - context compaction: real LLM summary or honest omission, never a fake "summarized" claim
 *  A6 - /v1/system/status: every entry comes from a real check (no hardcoded ONLINE / port 3000)
 *  A7 - remediation sandbox: never returns simulated output as a result
 *  A8 - plugin scaffolds: honest UNIMPLEMENTED error, never fake success
 *  A9 - DynamicWorkspace: no fake auto-heal request or fake format (source-level guard)
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Module mocks (declared before importing the units under test)
// ---------------------------------------------------------------------------

// A5: control the LLM gateway so tests never hit the network
vi.mock('../../services/llmGateway', () => ({
    llmGateway: { quickComplete: vi.fn() },
}));

// A7: keep remediationService importable without booting the orchestrator etc.
vi.mock('../../services/orchestrator', () => ({ orchestrator: {} }));
vi.mock('../../services/contextAssembler', () => ({ contextAssembler: {} }));
vi.mock('../../services/geminiService', () => ({
    generateAgentResponse: vi.fn(),
    configureGenAI: vi.fn(),
}));
vi.mock('../../services/sqliteService', () => ({
    sqliteService: { getLogs: vi.fn(() => []), getDbPath: () => '/tmp/test-db/silhouette.sqlite' },
}));
vi.mock('../../services/systemBus', () => ({
    systemBus: { subscribe: vi.fn(), emit: vi.fn() },
}));

import { ContextCompactionService } from '../../services/context/contextCompactionService';
import { llmGateway } from '../../services/llmGateway';
import { DockerSandbox } from '../../services/remediationService';
import { pluginFactory } from '../../services/plugins/pluginFactory';
import { systemController } from '../../server/controllers/systemController';

const quickComplete = llmGateway.quickComplete as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// A5 — Context compaction honesty
// ---------------------------------------------------------------------------

function buildOverBudgetHistory() {
    const head = [
        { role: 'system', content: 'You are Silhouette.' },
        { role: 'user', content: 'Initial instruction.' },
    ];
    const middle = Array.from({ length: 6 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `Middle message ${i}: `.padEnd(2000, 'x'), // ~500 tokens each
    }));
    const tail = [
        { role: 'user', content: 'Latest question.' },
        { role: 'assistant', content: 'Latest answer.' },
    ];
    return [...head, ...middle, ...tail];
}

const TIGHT_CONFIG = { tokenBudget: 200, reservedHead: 2, reservedTail: 2, maxToolOutputChars: 3000 };

describe('A5: context compaction never fakes a summary', () => {
    afterEach(() => quickComplete.mockReset());

    it('sync path drops the middle with an HONEST omission marker (no "summarized" claim)', () => {
        const svc = new ContextCompactionService();
        const out = svc.compactHistory(buildOverBudgetHistory(), TIGHT_CONFIG);
        const marker = out.find(m => m.role === 'system' && m.content.includes('[SYSTEM:'));
        expect(marker).toBeDefined();
        expect(marker!.content).toContain('OMITTED');
        expect(marker!.content).not.toContain('summarized: Interactions occurred');
        expect(marker!.content).not.toContain('SUMMARY OF OMITTED MESSAGES');
    });

    it('async path inserts a REAL LLM summary when the gateway provides one', async () => {
        quickComplete.mockResolvedValue('User asked about deployment. Assistant listed three blockers.');
        const svc = new ContextCompactionService();
        const out = await svc.compactHistoryAsync(buildOverBudgetHistory(), TIGHT_CONFIG);
        const marker = out.find(m => m.role === 'system' && m.content.includes('[SYSTEM:'));
        expect(marker).toBeDefined();
        expect(marker!.content).toContain('LLM-GENERATED summary');
        expect(marker!.content).toContain('User asked about deployment');
        expect(quickComplete).toHaveBeenCalledOnce();
    });

    it('async path falls back to honest omission when the LLM fails', async () => {
        quickComplete.mockRejectedValue(new Error('all providers unavailable'));
        const svc = new ContextCompactionService();
        const out = await svc.compactHistoryAsync(buildOverBudgetHistory(), TIGHT_CONFIG);
        const marker = out.find(m => m.role === 'system' && m.content.includes('[SYSTEM:'));
        expect(marker).toBeDefined();
        expect(marker!.content).toContain('OMITTED');
        expect(marker!.content).toContain('no summary of them exists');
    });

    it('async path treats an empty/short LLM output as no summary', async () => {
        quickComplete.mockResolvedValue('ok');
        const svc = new ContextCompactionService();
        const out = await svc.compactHistoryAsync(buildOverBudgetHistory(), TIGHT_CONFIG);
        const marker = out.find(m => m.role === 'system' && m.content.includes('[SYSTEM:'));
        expect(marker!.content).toContain('OMITTED');
        expect(marker!.content).not.toContain('SUMMARY OF OMITTED MESSAGES');
    });
});

// ---------------------------------------------------------------------------
// A6 — /v1/system/status reflects real checks
// ---------------------------------------------------------------------------

describe('A6: system status is derived from real probes', () => {
    it('reports the configured port (never the old hardcoded 3000) and a real db path', async () => {
        const json = vi.fn();
        await systemController.getStatus({} as any, { json } as any);
        expect(json).toHaveBeenCalledOnce();
        const payload = json.mock.calls[0][0];

        expect(['ONLINE', 'DEGRADED']).toContain(payload.status);
        expect(payload.uptime).toBeGreaterThan(0);

        const core = payload.services.find((s: any) => s.id === 'core');
        expect(core).toBeDefined();
        expect(core.port).not.toBe(3000); // old hardcoded wrong port
        expect(typeof core.port).toBe('number');

        const db = payload.services.find((s: any) => s.id === 'db');
        expect(db).toBeDefined();
        expect(db.url).toBeUndefined(); // old fabricated file:///db/... URL is gone
        expect(db.path).toContain('silhouette.sqlite');
    });
});

// ---------------------------------------------------------------------------
// A7 — Sandbox never returns simulated output
// ---------------------------------------------------------------------------

describe('A7: remediation sandbox honesty', () => {
    it('either really executes or fails with SANDBOX UNAVAILABLE — never simulated output', async () => {
        const sandbox = new DockerSandbox();
        try {
            const out = await sandbox.run('node:18-alpine', 'echo tanda2-probe');
            // Real execution environment (dockerode + daemon available)
            expect(out).toContain('tanda2-probe');
            expect(out).not.toContain('Simulated execution');
        } catch (e: any) {
            // Honest failure path: unavailable sandbox or a real container error
            expect(e.message).not.toContain('Simulated execution');
            expect(e.message).toMatch(/SANDBOX UNAVAILABLE|No such image|Container exited|docker/i);
        } finally {
            await sandbox.destroy();
        }
    }, 60000);

    it('source contains no simulated-execution fallback', () => {
        const src = readFileSync(join(process.cwd(), 'services/remediationService.ts'), 'utf-8');
        expect(src).not.toContain('Simulated execution of');
        expect(src).not.toContain('using simulation mode');
        expect(src).toContain('SANDBOX UNAVAILABLE');
    });
});

// ---------------------------------------------------------------------------
// A8 — Plugin scaffolds report honest UNIMPLEMENTED
// ---------------------------------------------------------------------------

describe('A8: pluginFactory scaffolds never fake success', () => {
    it('generated tools.ts returns UNIMPLEMENTED, README documents it', async () => {
        const id = `tanda2-test-${process.pid}-${Date.now()}`;
        const dir = join(process.cwd(), 'services', 'plugins', 'integrations', id);
        try {
            const result = await pluginFactory.createPlugin({
                name: 'Tanda2 Test',
                id,
                category: 'integrations',
                description: 'Truthfulness guard test plugin',
                tools: ['do_thing'],
            });
            expect(result.success).toBe(true);

            const toolsSrc = readFileSync(join(dir, 'tools.ts'), 'utf-8');
            expect(toolsSrc).toContain("'error'");
            expect(toolsSrc).toContain('UNIMPLEMENTED');
            expect(toolsSrc).not.toContain("status: 'success'");
            expect(toolsSrc).not.toContain('Tool executed stub.');

            const readmeSrc = readFileSync(join(dir, 'README.md'), 'utf-8');
            expect(readmeSrc).toContain('UNIMPLEMENTED');
        } finally {
            if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// A9 — DynamicWorkspace: no fake auto-heal / format (source-level guard)
// ---------------------------------------------------------------------------

describe('A9: workspace UI makes no fake action claims', () => {
    it('no simulated auto-heal request and no simulated format', () => {
        const src = readFileSync(join(process.cwd(), 'components/DynamicWorkspace.tsx'), 'utf-8');
        expect(src).not.toContain('Requesting immediate fix from TEAM_FIX');
        expect(src).not.toContain('Prettier simulation');
        expect(src).toContain('Automatic repair is not connected');
        expect(src).toContain('Format is unavailable');
    });
});
