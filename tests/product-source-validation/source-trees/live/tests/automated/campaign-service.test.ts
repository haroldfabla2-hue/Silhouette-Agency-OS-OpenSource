/**
 * CampaignService (the orphaned "Director's Brain" the route now reaches).
 * Real service; vectorMemory, geminiService, mediaService AND the
 * external-generation gate are declared doubles - no LLM, no stock API,
 * no effects. The DEPLOYED gate hard-blocks generation (CERO COBROS, no
 * override); tests that double it as "enabled" verify the PRESERVED
 * provider-path mechanics for a future designed grant mechanism, not the
 * behavior deployed today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getBrandTwin = vi.fn();
const queryBrandRules = vi.fn();
const generateShotlist = vi.fn();
const searchRealAssets = vi.fn();
// Closure-controlled doubles (plain functions, never reset - a vi.fn whose
// throwing implementation is reset/cleared is mis-flagged by vitest 4.0.16).
// gateEnabledInTest models a hypothetical FUTURE enabled gate; the real
// gate in this delivery always denies (see module header).
let gateEnabledInTest = true;

vi.mock('../../services/vectorMemoryService', () => ({
    vectorMemory: {
        getBrandTwin: (...a: any[]) => getBrandTwin(...a),
        queryBrandRules: (...a: any[]) => queryBrandRules(...a),
    }
}));
vi.mock('../../services/geminiService', () => ({
    geminiService: { generateShotlist: (...a: any[]) => generateShotlist(...a) }
}));
vi.mock('../../services/mediaService', () => ({
    mediaService: { searchRealAssets: (...a: any[]) => searchRealAssets(...a) }
}));
vi.mock('../../services/security/externalGenerationPolicy', () => ({
    assertCampaignLlmGenerationAllowed: () => {
        if (!gateEnabledInTest) {
            const e: any = new Error('EXTERNAL_GENERATION_DENIED: test denial');
            e.code = 'EXTERNAL_GENERATION_DENIED';
            e.name = 'ExternalGenerationDeniedError';
            throw e;
        }
    }
}));

import { campaignService } from '../../services/campaignService';

afterEach(() => { gateEnabledInTest = true; });

const BRAND = {
    id: 'brand_1', name: 'Acme',
    manifesto: { emotionalSpectrum: { primary: 'bold', secondary: ['neon'], forbidden: ['clowns'] } }
};
const SHOTLIST = {
    id: 'camp_1', name: 'Launch', brandId: 'brand_1', objective: 'obj',
    platform: 'INSTAGRAM', status: 'PLANNING',
    shotlist: [
        { id: 'shot_1', description: 'Hero' },
        { id: 'shot_2', description: 'Detail' }
    ]
};

beforeEach(() => {
    getBrandTwin.mockReset();
    queryBrandRules.mockReset();
    generateShotlist.mockReset();
    searchRealAssets.mockReset();
});

describe('campaignService.createCampaign', () => {
    it('returns null when the Brand Twin does not exist (no LLM call, no scouting)', async () => {
        getBrandTwin.mockResolvedValue(null);
        const out = await campaignService.createCampaign('obj', 'ghost');
        expect(out).toBeNull();
        expect(generateShotlist).not.toHaveBeenCalled();
        expect(searchRealAssets).not.toHaveBeenCalled();
    });

    it('throws SHOTLIST_UNAVAILABLE when generation is attempted but fails (e.g. no LLM key)', async () => {
        getBrandTwin.mockResolvedValue(BRAND);
        queryBrandRules.mockResolvedValue('rules');
        generateShotlist.mockResolvedValue(null);
        await expect(campaignService.createCampaign('obj', 'brand_1'))
            .rejects.toMatchObject({ code: 'SHOTLIST_UNAVAILABLE' });
        expect(searchRealAssets).not.toHaveBeenCalled();
    });

    it('hard block (deployed behavior): denial skips LLM and scouting; local prep still runs', async () => {
        gateEnabledInTest = false;
        getBrandTwin.mockResolvedValue(BRAND);
        queryBrandRules.mockResolvedValue('rules');
        await expect(campaignService.createCampaign('obj', 'brand_1'))
            .rejects.toMatchObject({ code: 'EXTERNAL_GENERATION_DENIED' });
        expect(getBrandTwin).toHaveBeenCalledTimes(1); // local prep ran
        expect(queryBrandRules).toHaveBeenCalledTimes(1);
        expect(generateShotlist).not.toHaveBeenCalled();
        expect(searchRealAssets).not.toHaveBeenCalled();
    });

    it('attaches auto-scouted anchors to shots when stock search hits', async () => {
        getBrandTwin.mockResolvedValue(BRAND);
        queryBrandRules.mockResolvedValue('rules');
        generateShotlist.mockResolvedValue(structuredClone(SHOTLIST));
        searchRealAssets.mockResolvedValue([{ url: 'https://img/full', thumb: 'https://img/thumb' }]);
        const out: any = await campaignService.createCampaign('obj', 'brand_1');
        expect(out.shotlist).toHaveLength(2);
        expect(out.shotlist[0].referenceImage).toBe('https://img/full');
        expect(out.shotlist[0].referenceThumb).toBe('https://img/thumb');
        expect(searchRealAssets).toHaveBeenCalledTimes(2);
    });

    it('degrades gracefully: scout failure leaves the shot without anchor', async () => {
        getBrandTwin.mockResolvedValue(BRAND);
        queryBrandRules.mockResolvedValue('rules');
        generateShotlist.mockResolvedValue(structuredClone(SHOTLIST));
        searchRealAssets.mockRejectedValue(new Error('no unsplash key'));
        const out: any = await campaignService.createCampaign('obj', 'brand_1');
        expect(out.shotlist).toHaveLength(2);
        expect(out.shotlist[0].referenceImage).toBeUndefined();
    });
});
