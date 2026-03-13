import { StockImage, BrandDNA, CreativeContext } from '../types';
import { DEFAULT_API_CONFIG } from '../constants';
import { costEstimator } from './costEstimator';




export class StockService {
    private apiKey: string | null = null;

    constructor() {
        // Lazy load - do not fetch immediately to avoid server startup race conditions
    }

    public setConfig(apiKey: string) {
        this.apiKey = apiKey;
        console.log("[StockService] API Key configured manually.");
    }

    private async loadConfig() {
        if (this.apiKey) return; // Already loaded
        try {
            // First try secrets vault (new secure storage)
            const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/system/secrets/unsplash`, {
                headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.credentials?.accessKey) {
                    this.apiKey = data.credentials.accessKey;
                    console.log("[StockService] Loaded API Key from Secrets Vault.");
                    return;
                }
            }
        } catch (e) {
            // Vault might not be available
        }
        try {
            // Fallback to system config
            const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/system/config`);
            const config = await res.json();
            if (config.unsplashKey) {
                this.apiKey = config.unsplashKey;
                console.log("[StockService] Loaded API Key from System Config.");
            }
        } catch (e) {
            console.warn("[StockService] Failed to load config:", e);
        }
    }

    /**
     * Searches for "Base Plate" images that match the query and context.
     */
    public async searchBasePlate(query: string, context?: CreativeContext): Promise<StockImage[]> {
        return this.searchImages(query, context);
    }

    public async searchImages(query: string, context?: CreativeContext): Promise<StockImage[]> {
        console.log(`[StockService] Searching for: "${query}" with Context: ${context?.identity.name || 'None'}`);

        let optimizedQuery = query;

        // 1. AI Optimization (Translate & Keyword Extraction)
        try {
            const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/media/optimize-search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
                },
                body: JSON.stringify({ prompt: query })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.keywords) {
                    optimizedQuery = data.keywords;
                    console.log(`[StockService] AI Optimized Query: "${optimizedQuery}"`);
                }
            }
        } catch (e) {
            console.warn("[StockService] AI Optimization failed, using raw query:", e);
        }

        // 2. Enhance Query with Context Vibe (if not already covered by AI)
        if (context && optimizedQuery.split(' ').length < 5) {
            const vibeKeywords = context.inspirations.keywords.join(' ');
            optimizedQuery = `${optimizedQuery} ${vibeKeywords}`;
        }

        // 3. Try Real API Call
        if (this.apiKey) {
            return this.fetchFromUnsplash(optimizedQuery, this.apiKey);
        }

        // Try re-loading config just in case it was added recently
        await this.loadConfig();
        if (this.apiKey) {
            return this.fetchFromUnsplash(optimizedQuery, this.apiKey);
        }

        // NO MOCK DATA — return empty with clear error
        console.warn("[StockService] ⚠️ No UNSPLASH_ACCESS_KEY configured. Set it in Settings → Integrations or .env.local.");
        return [];
    }

    private async fetchFromUnsplash(query: string, apiKey: string): Promise<StockImage[]> {
        try {
            const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=squarish`, {
                headers: {
                    'Authorization': `Client-ID ${apiKey}`
                }
            });

            if (!res.ok) throw new Error(`Unsplash API Error: ${res.statusText}`);

            const data = await res.json();

            // Track Cost (Request)
            costEstimator.trackEvent('unsplash-api', 1);

            return data.results.map((img: any) => ({
                id: img.id,
                url: img.urls.regular,
                thumb: img.urls.small,
                photographer: img.user.name,
                description: img.alt_description || img.description || 'Stock Photo',
                primaryColor: img.color
            }));
        } catch (error) {
            console.error("[StockService] API request failed:", error);
            return [];
        }
    }

    /**
     * Future: Implement color matching algorithm
     * Calculates distance between brand colors and image dominant color.
     */
    private calculateColorMatch(brandHex: string, imageHex: string): number {
        // Placeholder for Delta-E color difference logic
        return 0.9;
    }
}

export const stockService = new StockService();
