import { costEstimator } from "./costEstimator";
import { SystemProtocol } from "../types";
import { systemBus } from "./systemBus";
import { settingsManager } from "./settingsManager";
import { configLoader } from "../server/config/configLoader"; // [FIX] Import configLoader

// --- CFO AGENT (Chief Financial Officer) ---
// The Guardian of the Wallet.
// Active Role: Negotiates models, enforces budgets, and detects anomalies.

export interface BudgetConfig {
    maxDailyCost: number;
    maxSessionCost: number;
    requireApprovalThreshold: number; // Cost per request that triggers manual approval
}

export class CFOAgent {
    private static instance: CFOAgent;
    private config: BudgetConfig = {
        maxDailyCost: 50.00, // $50/day limit
        maxSessionCost: 10.00, // $10/session limit
        requireApprovalThreshold: 0.50 // Ask if request > $0.50
    };

    private constructor() {
        console.log("[CFO] Guardian Active. Monitoring Wallet.");
    }

    public static getInstance(): CFOAgent {
        if (!CFOAgent.instance) {
            CFOAgent.instance = new CFOAgent();
        }
        return CFOAgent.instance;
    }

    public updateConfig(newConfig: Partial<BudgetConfig>) {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * INTELLIGENT NEGOTIATION V2
     * Decides which model to use based on:
     * - Agent category (DEV agents → MiniMax M2.1 via OpenRouter)
     * - Prompt complexity and type
     * - Cost efficiency
     * - Available APIs with fallback chain
     * 
     * Fallback Chain for CODE: MiniMax → DeepSeek → Gemini → ZhipuAI → Ollama
     */
    public negotiateModel(prompt: string, preferredModel: string, context: any): string {
        const metrics = costEstimator.getMetrics();
        const settings = settingsManager.getSettings();
        const agentCategory = context?.category;
        const agentName = context?.agentName || 'unknown';

        // 1. BUDGET CHECK
        if (metrics.sessionCost > this.config.maxSessionCost) {
            throw new Error(`[CFO] 🛑 Session Budget Exceeded ($${this.config.maxSessionCost}). Operation Halted.`);
        }

        // 2. CHECK MINIMAX AVAILABILITY (PRIME DIRECTIVE for Phase 10)
        const config = configLoader.getConfig();
        const hasMinimax = !!config.llm.providers.minimax?.apiKey;

        if (hasMinimax) {
            // [PHASE 10.5] HYBRID INTELLIGENCE (Smart Routing)
            // Goal: Conserve Minimax 500-prompt quota for high-value tasks.

            const isVisionTask = prompt.includes('[VISION_REQUIRED]') || context?.hasImage;

            // 1. VISION -> Gemini (Minimax M2.5 is text-only/focused)
            if (isVisionTask) {
                console.log(`[CFO] 👁️ Vision Task detected. Delegating to Gemini.`);
                return 'gemini-2.0-flash';
            }

            // 2. COMPLEXITY ANALYSIS
            // We want Minimax for: Coding, Deep Reasoning, Creative Writing.
            // We want Gemini for: Quick chats, simple queries, maintenance.

            const isCode = /code|function|class|import|bug|fix|refactor|typescript|javascript|python|implement|json/i.test(prompt);
            const isReasoning = /analyze|plan|strategy|why|how|explain|compare|evaluate/i.test(prompt);
            const isLongContext = prompt.length > 300; // Arbitrary threshold for "substantial" thought

            const isHighValue = isCode || isReasoning || isLongContext;

            if (isHighValue) {
                console.log(`[CFO] 🧠 High-Value Task (Code/Reasoning). Using Minimax Prime.`);
                return 'abab-6.5s-chat';
            } else {
                console.log(`[CFO] ⚡ Low-Complexity Task. Offloading to Gemini Flash to save Quota.`);
                return 'gemini-2.0-flash';
            }
        }

        // --- FALLBACK LOGIC IF MINIMAX IS MISSING ---

        // 3. API AVAILABILITY CHECK
        const hasOpenAI = settings.registeredIntegrations.find(i => i.id === 'openai')?.isConnected;
        const hasAnthropic = settings.registeredIntegrations.find(i => i.id === 'anthropic')?.isConnected;
        const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
        const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
        const hasZhipuAI = !!process.env.ZHIPU_API_KEY || !!process.env.ZHIPUAI_API_KEY;
        const hasOllama = !!process.env.OLLAMA_BASE_URL || true;

        // 3. COMPLEXITY & TYPE ANALYSIS
        const isCode = /code|function|class|import|bug|fix|refactor|typescript|javascript|python|implement/i.test(prompt);
        const isCreative = /story|poem|creative|design|imagine/i.test(prompt);
        const isComplex = prompt.length > 1000 || isCode || isCreative;
        const isDevAgent = agentCategory === 'DEV' || agentCategory === 'INTEGRATION';

        // 4. MODEL SELECTION STRATEGY FOR CODE TASKS

        // === CASE A: DEV AGENT OR CODE TASK → MINIMAX 2.5 (Direct) ===
        if ((isDevAgent || isCode) && hasOpenRouter) {
            console.log(`[CFO] 🎯 Code task detected${isDevAgent ? ` (Agent: ${agentName}, Category: ${agentCategory})` : ''}. Using MiniMax 2.5.`);
            return 'abab-6.5s-chat';
        }

        // === MINIMAX FALLBACK → DEEPSEEK ===
        if ((isDevAgent || isCode) && hasDeepSeek) {
            console.log(`[CFO] ⚠️ OpenRouter unavailable. Fallback to DeepSeek.`);
            return 'deepseek-coder';
        }

        // === DEEPSEEK FALLBACK → ZHIPUAI (FREE) ===
        if ((isDevAgent || isCode) && hasZhipuAI) {
            console.log(`[CFO] ⚠️ DeepSeek unavailable. Fallback to ZhipuAI (FREE).`);
            return 'glm-4.5-flash';
        }

        // === ZHIPUAI FALLBACK → GEMINI (FREE) ===
        if (isDevAgent || isCode) {
            console.log(`[CFO] ⚠️ ZhipuAI unavailable. Fallback to Gemini.`);
            if (isComplex) return 'gemini-1.5-pro';
            return 'gemini-2.5-flash';
        }

        // Note: Ollama is last resort handled by geminiService when all cloud fails

        console.log(`[CFO] Defaulting to Gemini 2.0 Flash.`);
        return 'gemini-2.0-flash';

    }


    /**
     * VRAM ARBITRATION
     * Manages conflict between Local LLM (Ollama) and Local TTS (Coqui).
     * Both need VRAM. If we run Ollama, we sleep TTS.
     */
    private async optimizeResourcesForModel(modelId: string) {
        // dynamic import to avoid cycles
        const { ttsService } = await import('./ttsService');

        const isLocalLLM = modelId.includes('ollama') || modelId.includes('local');

        if (isLocalLLM) {
            console.log(`[CFO] 💾 Local LLM selected (${modelId}). Signaling TTS to SLEEP to free VRAM.`);
            await ttsService.sleep();
        } else {
            // If Cloud LLM, we likely have VRAM available for TTS
            // We wake it up preemptively so it's ready for the response
            // console.log(`[CFO] ☁️ Cloud LLM selected. Signaling TTS to WAKE.`);
            await ttsService.wake();
        }
    }

    /**
     * Get the fallback chain for a model type
     */
    public getFallbackChain(taskType: 'CODE' | 'CREATIVE' | 'GENERAL'): string[] {
        switch (taskType) {
            case 'CODE':
                // Minimax Prime
                return ['abab-6.5s-chat', 'deepseek-coder', 'gemini-1.5-pro', 'glm-4.5-flash'];
            case 'CREATIVE':
                return ['abab-6.5s-chat', 'gemini-1.5-pro', 'glm-4.5-flash'];
            case 'GENERAL':
            default:
                return ['abab-6.5s-chat', 'gemini-1.5-flash', 'glm-4.5-flash'];
        }
    }

    /**
     * COST SPIKE DETECTOR
     * Checks if an agent is burning money too fast (Infinite Loop).
     */
    public checkAnomalies(agentId: string, recentCost: number) {
        // If a single agent spends > $1.00 in 1 minute, flag it.
        if (recentCost > 2.00) {
            console.warn(`[CFO] ⚠️ High Cost Alert! Agent ${agentId} spent $${recentCost.toFixed(2)} recently.`);
            systemBus.emit(SystemProtocol.COST_ANOMALY, { agentId, cost: recentCost }, 'CFO');
        }
    }

    /**
     * APPROVAL GATE
     * Returns true if the operation requires explicit user approval.
     */
    public requiresApproval(estimatedCost: number): boolean {
        return estimatedCost > this.config.requireApprovalThreshold;
    }
}

export const cfo = CFOAgent.getInstance();
