import { geminiService } from './geminiService';
import { vectorMemory } from './vectorMemoryService';
import { mediaService } from './mediaService'; // Import MediaService
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

        // 3. Generate Shotlist via Gemini (The "Vision")
        const blueprint = await geminiService.generateShotlist(objective, brand, rules);

        if (blueprint) {
            // 4. AUTO-SCOUT: Find Real-World Anchors for each shot
            console.log("[CampaignService] Auto-Scouting Real-World Anchors...");
            blueprint.shotlist = await this.autoScout(blueprint.shotlist, brand.manifesto.emotionalSpectrum.secondary.join(' '));
        }

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
                    // Attach the best match as the "anchor"
                    // We'll store it in a new property (we might need to extend ShotSpec or just use 'scoutUrl')
                    // For now, let's assume we can attach it to the description or a new field if we updated types.
                    // To avoid type errors without updating types.ts yet, we'll append it to the description for the UI to parse,
                    // OR better, we just return the shot with a new property if we cast it.
                    // Let's update types.ts properly in the next step, but for now, let's just log it.

                    // ACTUALLY: Let's use the 'referenceImage' field if it exists, or add it.
                    // Checking types.ts... ShotSpec doesn't have it.
                    // I will add a temporary property via casting.
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
