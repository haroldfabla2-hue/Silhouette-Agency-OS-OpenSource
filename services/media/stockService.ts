
import { createApi } from 'unsplash-js';
import nodeFetch from 'node-fetch';

export class StockService {
    private unsplash: any;

    constructor() {
        const accessKey = process.env.UNSPLASH_ACCESS_KEY;
        if (accessKey) {
            this.unsplash = createApi({
                accessKey: accessKey,
                fetch: nodeFetch as any,
            });
            console.log("[StockService] Unsplash Connected.");
        } else {
            console.warn("[StockService] ⚠️ UNSPLASH_ACCESS_KEY missing.");
        }
    }

    public async searchPhoto(query: string, orientation: 'landscape' | 'portrait' | 'squarish' = 'landscape'): Promise<string | null> {
        if (!this.unsplash) return null;

        console.log(`[StockService] 📷 Searching Unsplash: "${query}"`);

        try {
            const result = await this.unsplash.search.getPhotos({
                query: query,
                page: 1,
                perPage: 1,
                orientation: orientation,
                contentFilter: 'high',
            });

            if (result.errors) {
                console.error('[StockService] API Error:', result.errors[0]);
                return null;
            }

            const photo = result.response.results[0];
            if (!photo) return null;

            // Trigger download event (Required by Unsplash API Guidelines)
            try {
                await this.unsplash.photos.trackDownload({
                    downloadLocation: photo.links.download_location,
                });
            } catch (e) {
                // Ignore tracking errors
            }

            return photo.urls.regular; // Good quality for web

        } catch (error) {
            console.error("[StockService] Search Failed:", error);
            return null;
        }
    }
}

export const stockService = new StockService();
