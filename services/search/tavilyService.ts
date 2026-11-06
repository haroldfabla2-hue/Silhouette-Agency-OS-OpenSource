
import { tavily } from "@tavily/core";

export interface SearchResult {
    title: string;
    url: string;
    content: string;
    score: number;
}

export class TavilyService {
    private client: any | null = null;

    constructor() {
        const apiKey = process.env.TAVILY_API_KEY;
        if (apiKey) {
            this.client = tavily({ apiKey });
            console.log("[Tavily] Service Initialized.");
        }
    }

    public async searchContext(query: string, maxResults: number = 3): Promise<SearchResult[]> {
        if (!this.client) {
            console.log("[Tavily] Deep search skipped: TAVILY_API_KEY not configured.");
            return [];
        }

        console.log(`[Tavily] 🔍 Deep Search: "${query}"`);

        try {
            const response = await this.client.search(query, {
                search_depth: "advanced",
                max_results: maxResults,
                include_answer: true
            });

            return response.results.map((r: any) => ({
                title: r.title,
                url: r.url,
                content: r.content,
                score: r.score
            }));

        } catch (error) {
            console.error("[Tavily] Search Failed:", error);
            return [];
        }
    }
}

export const tavilyService = new TavilyService();
