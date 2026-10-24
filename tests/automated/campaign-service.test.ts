/**
 * CampaignService (the orphaned "Director's Brain" the route now reaches).
 * Real service; vectorMemory, geminiService and mediaService are declared
 * doubles - no LLM, no stock API, no effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBrandTwin = vi.fn();
const queryBrandRules = vi.fn();
const generateShotlist = vi.fn();
const searchRealAssets = vi.fn();

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

import { campaignService } from '../../services/campaignService';

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

    it('returns null when shotlist generation is unavailable (e.g. no LLM key)', async () => {
        getBrandTwin.mockResolvedValue(BRAND);
        queryBrandRules.mockResolvedValue('rules');
        generateShotlist.mockResolvedValue(null);
        const out = await campaignService.createCampaign('obj', 'brand_1');
        expect(out).toBeNull();
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
