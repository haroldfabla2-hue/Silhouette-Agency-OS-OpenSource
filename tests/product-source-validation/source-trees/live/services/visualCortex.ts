import { systemBus } from './systemBus';
import { stockService } from './stockService';
import { uiContext } from './uiContext'; // Import uiContext
import { SystemProtocol } from '../types'; // Import SystemProtocol
import { CreativeContext, VisualGenerationRequest, HybridAsset } from '../types';

class VisualCortex {
    private activeAssets: Map<string, HybridAsset> = new Map();

    constructor() {
        console.log('[VisualCortex] Initialized. Ready for Hybrid Flow.');
        this.setupListeners();
    }

    private setupListeners() {
        // Listen for requests from the Orchestrator or UI
        // Listen for requests from the Orchestrator or UI
        // @ts-ignore
        // [PA-045] DISABLE BACKEND LISTENER. The Frontend (via server/index.ts Bridge) handles this now.
        // systemBus.subscribe(SystemProtocol.VISUAL_REQUEST, this.handleRequest.bind(this));
    }

    private async handleRequest(payload: any) {
        console.log("[VisualCortex NO-OP] Backend received request, waiting for Frontend Bridge...");
        // This is now handled by the Frontend Component -> Bridge -> VISUAL_SNAPSHOT emission.
    }

    /**
     * STAGE 1 & 2: Context & Base Plate
     * Analyzes the request and finds the perfect real-world background.
     */
    public async initiateHybridFlow(request: VisualGenerationRequest, context: CreativeContext): Promise<HybridAsset> {
        const assetId = crypto.randomUUID();
        console.log(`[VisualCortex] Starting Hybrid Flow for Asset ${assetId} with Context: ${context.identity.name}`);

        // 1. Create Draft Asset
        const newAsset: HybridAsset = {
            id: assetId,
            requestId: request.id,
            layers: [],
            status: 'DRAFT'
        };
        this.activeAssets.set(assetId, newAsset);

        // 2. Generate Search Query (Simulating Gemini Logic)
        // In a real implementation, we'd ask Gemini: "Convert '${request.prompt}' into a stock photo search query based on ${context.inspirations.mood}"
        const searchQuery = `${request.prompt} background`;

        // 3. Search Base Plates
        const basePlates = await stockService.searchBasePlate(searchQuery, context);

        if (basePlates.length > 0) {
            // Auto-select the first one for the draft (User can change later)
            const selectedBase = basePlates[0];

            newAsset.layers.push({
                id: crypto.randomUUID(),
                type: 'BASE_PLATE',
                url: selectedBase.url,
                position: { x: 0, y: 0, scale: 1, rotation: 0 },
                blendMode: 'normal'
            });

            console.log(`[VisualCortex] Base Plate Selected: ${selectedBase.description}`);
        }

        return newAsset;
    }

    public getAsset(id: string): HybridAsset | undefined {
        return this.activeAssets.get(id);
    }
}

export const visualCortex = new VisualCortex();
