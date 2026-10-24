/**
 * Campaign Director route - POST /v1/media/campaign/create.
 * Real express router + real controller over real local HTTP;
 * campaignService is a declared double (no LLM, no stock API, no effects,
 * no quota). Follows the repo's route-test pattern (listen(0) + fetch).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';

const createCampaign = vi.fn();
vi.mock('../../services/campaignService', () => ({
    campaignService: { createCampaign: (...a: any[]) => createCampaign(...a) }
}));
// The controller imports several heavy media services; stub them all.
vi.mock('../../services/mediaService', () => ({ mediaService: {} }));
vi.mock('../../services/mediaManager', () => ({ mediaManager: {} }));
vi.mock('../../services/media/videoFactory', () => ({ videoFactory: {} }));
vi.mock('../../services/media/localVideoService', () => ({ localVideoService: {} }));
vi.mock('../../services/resourceManager', () => ({ resourceManager: {} }));
vi.mock('../../services/stockService', () => ({ stockService: {} }));
vi.mock('../../services/security/capabilityState', () => ({ isDemoModeEnabled: () => false }));

let server: http.Server;
let port: number;

async function post(body: any) {
    const res = await fetch(`http://127.0.0.1:${port}/v1/media/campaign/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { status: res.status, json: await res.json() as any };
}

const BLUEPRINT = {
    id: 'camp_1', name: 'Launch', brandId: 'brand_1', objective: 'Launch product',
    platform: 'INSTAGRAM', shotlist: [{ id: 'shot_1', description: 'Hero shot' }], status: 'PLANNING'
};

beforeAll(async () => {
    const { default: campaignRouter } = await import('../../server/routes/v1/media.routes');
    const app = express();
    app.use(express.json());
    app.use('/v1/media', campaignRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as any).port;
});

afterAll(() => server?.close());

describe('POST /v1/media/campaign/create', () => {
    it('400 when objective or brandId is missing', async () => {
        expect((await post({ brandId: 'b' })).status).toBe(400);
        expect((await post({ objective: 'o' })).status).toBe(400);
        expect((await post({})).status).toBe(400);
        expect(createCampaign).not.toHaveBeenCalled();
    });

    it('200 returns the blueprint the service produced (contract passthrough)', async () => {
        createCampaign.mockResolvedValue(BLUEPRINT);
        const { status, json } = await post({ objective: 'Launch product', brandId: 'brand_1' });
        expect(status).toBe(200);
        expect(json).toEqual(BLUEPRINT);
        expect(createCampaign).toHaveBeenCalledWith('Launch product', 'brand_1');
    });

    it('404 only when the Brand Twin is missing (service returns null)', async () => {
        createCampaign.mockResolvedValue(null);
        const { status, json } = await post({ objective: 'x', brandId: 'ghost' });
        expect(status).toBe(404);
        expect(json.code).toBe('BRAND_TWIN_NOT_FOUND');
    });

    it('503 with code when external generation is denied (fail-closed, CERO COBROS)', async () => {
        createCampaign.mockImplementation(async () => {
            const e: any = new Error('EXTERNAL_GENERATION_DENIED: test');
            e.code = 'EXTERNAL_GENERATION_DENIED';
            throw e;
        });
        const { status, json } = await post({ objective: 'x', brandId: 'b' });
        expect(status).toBe(503);
        expect(json.code).toBe('EXTERNAL_GENERATION_DENIED');
    });

    it('503 with code when shotlist generation is unavailable (distinct from 404)', async () => {
        createCampaign.mockImplementation(async () => {
            const e: any = new Error('Shotlist generation is unavailable on this deployment (external generation misconfigured or failed).');
            e.code = 'SHOTLIST_UNAVAILABLE';
            throw e;
        });
        const { status, json } = await post({ objective: 'x', brandId: 'b' });
        expect(status).toBe(503);
        expect(json.code).toBe('SHOTLIST_UNAVAILABLE');
    });

    it('500 with a generic message when the service throws unexpectedly (no raw internals leak)', async () => {
        createCampaign.mockImplementation(async () => { throw new Error('llm exploded'); });
        const { status, json } = await post({ objective: 'x', brandId: 'b' });
        expect(status).toBe(500);
        expect(json.error).toBe('Campaign planning failed');
        expect(JSON.stringify(json)).not.toContain('llm exploded');
    });
});
