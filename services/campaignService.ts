import { geminiService } from './geminiService';
import { vectorMemory } from './vectorMemoryService';
import { mediaService } from './mediaService'; // Import MediaService
import { assertCampaignLlmGenerationAllowed } from './security/externalGenerationPolicy';

/** Shotlist generation was attempted but is unavailable (no key, LLM error,
 * unparseable output). Distinct from a missing Brand Twin (404). */
export class CampaignShotlistUnavailableError extends Error {
    public readonly code = 'SHOTLIST_UNAVAILABLE' as const;
    constructor() {
        super('Shotlist generation is unavailable on this deployment (external generation misconfigured or failed).');
        this.name = 'CampaignShotlistUnavailableError';
    }
}
import { BrandDigitalTwin, CampaignBlueprint, ShotSpec } from '../types';

class CampaignService {

    /**
     * The Director's Brain: Generates a full campaign shotlist based on Brand DNA and User Objective.
     */
    async createCampaign(objective: string, brandId: string): Promise<CampaignBlueprint | null> {
        console.log(`[CampaignService] Director 'mkt-lead' starting campaign: "${objective}"`);

        // 1. Retrieve Brand DNA (The "Bible")
        const brand = await vectorMemory.getBrandTwin(brandId);
        if (!brand) {
            console.error("[CampaignService] Brand Twin not found.");
            return null;
        }

        // 2. Retrieve Brand Rules (The "Law")
        const rules = await vectorMemory.queryBrandRules(brandId, objective);

        // 3. Hard block (CERO COBROS): the shotlist call reaches an external
        // LLM whose cost is entitlement-dependent and unverifiable from code.
        // This delivery blocks it unconditionally - deliberately NO boolean
        // override (a flag is not monetary authority). Steps 4-5 are the
        // PRESERVED capability: reachable only once a designed, verifiable,
        // non-boolean monetary authorization mechanism lands (reserved owner
        // decision). Local preparation above is unaffected by the block.
        assertCampaignLlmGenerationAllowed();

        // 4. Generate Shotlist via Gemini (The "Vision"). A null return means
        // generation was attempted but unavailable - NOT a missing brand.
        const blueprint = await geminiService.generateShotlist(objective, brand, rules);
        if (!blueprint) {
            throw new CampaignShotlistUnavailableError();
        }

        // 5. AUTO-SCOUT: Find Real-World Anchors for each shot
        console.log("[CampaignService] Auto-Scouting Real-World Anchors...");
        blueprint.shotlist = await this.autoScout(blueprint.shotlist, brand.manifesto.emotionalSpectrum.secondary.join(' '));

        return blueprint;
    }

    /**
     * The Scout: Finds Unsplash images to serve as "Real-World Anchors" for the shots.
     */
    private async autoScout(shots: ShotSpec[], brandVibe: string): Promise<ShotSpec[]> {
        const scoutedShots = await Promise.all(shots.map(async (shot) => {
            try {
                // Construct a search query that mixes the shot description with the brand vibe
                // e.g. "Low angle cyberpunk city neon style"
                const query = `${shot.description} ${brandVibe} style`;
                const results = await mediaService.searchRealAssets(query);

                if (results && results.length > 0) {
                    // Attach the best match as the real-world anchor
                    // (typed ShotSpec.referenceImage / referenceThumb).
                    return { ...shot, referenceImage: results[0].url, referenceThumb: results[0].thumb };
                }
            } catch (e) {
                console.warn(`[CampaignService] Auto-Scout failed for shot ${shot.id}`, e);
            }
            return shot;
        }));
        return scoutedShots;
    }
}

export const campaignService = new CampaignService();
