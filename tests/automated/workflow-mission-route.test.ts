import { describe, it, expect, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import fs from 'fs';
import path from 'path';

// Regression: there was no way to seed a real mission into the autonomous loop.
// startNewCycle() always began with an empty intent, so the 24/7 mode re-read
// stale chat input from volatile memory and chat missions never entered the
// workflow at all. POST /v1/workflow/mission seeds pipelineData.input and the
// INTENT stage must prefer it over volatile memory.

const ROOT = path.resolve(__dirname, '..', '..');

async function bootApp() {
    const { default: workflowRouter } = await import('../../server/routes/v1/workflow.routes');
    const app = express();
    app.use(express.json());
    app.use('/v1/workflow', workflowRouter);
    const server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as any).port;
    return { server, port };
}

async function postMission(port: number, body: any) {
    const res = await fetch(`http://127.0.0.1:${port}/v1/workflow/mission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { status: res.status, json: await res.json() as any };
}

describe('POST /v1/workflow/mission', () => {
    // Importing the workflow route boots the workflowEngine singleton, whose
    // imports fire dynamic imports (dreamerService -> powerManager) and a Redis
    // connection. Drain and close explicitly so teardown is deterministic.
    afterAll(async () => {
        const { workflowEngine } = await import('../../services/workflowEngine');
        const { WorkflowStage } = await import('../../types');
        (workflowEngine as any).currentStage = WorkflowStage.IDLE;
        (workflowEngine as any).isProcessing = false;
        (workflowEngine as any).pipelineData = {};
        const mod: any = await import('../../services/dreamerService');
        for (let i = 0; i < 100 && !mod.dreamer; i++) {
            await new Promise(r => setTimeout(r, 50));
        }
        mod.dreamer?.stopDreamingLoop();
        const { redisClient } = await import('../../services/redisClient');
        await redisClient.disconnect();
    });

    it('rejects missing, empty, non-string and over-length missions with 400', async () => {
        const { server, port } = await bootApp();
        try {
            for (const body of [{}, { mission: '' }, { mission: '   ' }, { mission: 42 }, { mission: 'x'.repeat(2001) }]) {
                const { status, json } = await postMission(port, body);
                expect(status).toBe(400);
                expect(json.error).toMatch(/mission must be/);
            }
        } finally {
            server.close();
        }
    });

    it('accepts a real mission with 202, starts the cycle at INTENT and seeds pipelineData.input', async () => {
        const { server, port } = await bootApp();
        try {
            const { workflowEngine } = await import('../../services/workflowEngine');
            const { WorkflowStage } = await import('../../types');
            (workflowEngine as any).currentStage = WorkflowStage.IDLE;
            (workflowEngine as any).isProcessing = false;
            (workflowEngine as any).pipelineData = {};
            (workflowEngine as any).config.enabled = false; // prove the endpoint enables the run itself

            const mission = 'Audit the memory subsystem and report duplicates';
            const { status, json } = await postMission(port, { mission });

            expect(status).toBe(202);
            expect(json.success).toBe(true);
            expect(json.mission).toBe(mission);
            expect(json.stageLabel).toBe('INTENT_ANALYSIS');

            expect(workflowEngine.getStage()).toBe(WorkflowStage.INTENT);
            expect((workflowEngine as any).pipelineData.input).toBe(mission);
            expect((workflowEngine as any).pipelineData.missionSource).toBe('api');
            expect((workflowEngine as any).config.enabled).toBe(true);
            expect((workflowEngine as any).config.mode24_7).toBe(false); // untouched
        } finally {
            server.close();
        }
    });

    it('returns 409 while a cycle is in flight (never interrupts it)', async () => {
        const { server, port } = await bootApp();
        try {
            const { workflowEngine } = await import('../../services/workflowEngine');
            const { WorkflowStage } = await import('../../types');
            (workflowEngine as any).currentStage = WorkflowStage.IDLE;
            (workflowEngine as any).isProcessing = false;
            (workflowEngine as any).pipelineData = {};
            const first = await postMission(port, { mission: 'first mission' });
            expect(first.status).toBe(202);
            const second = await postMission(port, { mission: 'second mission' });
            expect(second.status).toBe(409);
            expect(second.json.error).toMatch(/busy/i);
        } finally {
            server.close();
        }
    });

    it('INTENT analysis prefers the seeded mission over volatile memory (source guard)', () => {
        const engine = fs.readFileSync(path.join(ROOT, 'services/workflowEngine.ts'), 'utf8');
        const analyze = engine.slice(engine.indexOf('analyzeIntentAndResearchNeeds'));
        expect(analyze).toMatch(/pipelineData\.input/);
        const engineAll = engine;
        expect(engineAll).toMatch(/public startMission\(mission: string\)/);
        const routes = fs.readFileSync(path.join(ROOT, 'server/routes/v1/workflow.routes.ts'), 'utf8');
        expect(routes).toMatch(/router\.post\('\/mission'/);
    });
});
