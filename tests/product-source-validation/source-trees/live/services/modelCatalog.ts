/**
 * MODEL CATALOG SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Central registry for all supported LLM models and their capabilities.
 * Modular provider architecture for easy scaling.
 */

export interface ModelCatalogEntry {
    id: string;
    name: string;
    provider: 'GEMINI' | 'GROQ' | 'DEEPSEEK' | 'OLLAMA' | 'MINIMAX' | 'ZHIPUAI' | 'OPENROUTER';
    contextWindow: number;
    capabilities: {
        vision: boolean;
        reasoning: boolean;
        toolUse: boolean;
        streaming: boolean;
        audio?: boolean;
    };
    isLocal: boolean;
    costPer1kTokens?: number; // Optional reference
}

export const modelCatalog: ModelCatalogEntry[] = [
    // --- GEMINI ---
    {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        provider: 'GEMINI',
        contextWindow: 1048576,
        capabilities: { vision: true, reasoning: false, toolUse: true, streaming: true, audio: true },
        isLocal: false
    },
    {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        provider: 'GEMINI',
        contextWindow: 2097152,
        capabilities: { vision: true, reasoning: false, toolUse: true, streaming: true, audio: true },
        isLocal: false
    },

    // --- GROQ (verified live against GET /models 2026-10-14: llama-3.x retired) ---
    {
        id: 'openai/gpt-oss-120b',
        name: 'GPT-OSS 120B (Groq)',
        provider: 'GROQ',
        contextWindow: 131072,
        capabilities: { vision: false, reasoning: true, toolUse: true, streaming: true },
        isLocal: false
    },
    {
        id: 'openai/gpt-oss-20b',
        name: 'GPT-OSS 20B (Groq)',
        provider: 'GROQ',
        contextWindow: 131072,
        capabilities: { vision: false, reasoning: true, toolUse: true, streaming: true },
        isLocal: false
    },

    // --- DEEPSEEK ---
    {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        provider: 'DEEPSEEK',
        contextWindow: 64000,
        capabilities: { vision: false, reasoning: false, toolUse: true, streaming: true },
        isLocal: false
    },
    {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1 (Reasoner)',
        provider: 'DEEPSEEK',
        contextWindow: 64000,
        capabilities: { vision: false, reasoning: true, toolUse: false, streaming: true },
        isLocal: false
    },

    // --- MINIMAX ---
    {
        // Current MiniMax chat model (the previous abab generation was retired by the vendor).
        // Specs per https://platform.minimax.io/docs/guides/text-generation
        id: 'MiniMax-M2.7-highspeed',
        name: 'MiniMax M2.7 Highspeed',
        provider: 'MINIMAX',
        contextWindow: 204800,
        capabilities: { vision: false, reasoning: true, toolUse: true, streaming: true },
        isLocal: false
    },

    // --- ZHIPUAI ---
    {
        id: 'glm-4-flash',
        name: 'GLM-4 Flash (Zhipu)',
        provider: 'ZHIPUAI',
        contextWindow: 128000,
        capabilities: { vision: false, reasoning: false, toolUse: true, streaming: true },
        isLocal: false
    },

    // --- OLLAMA (Local) ---
    {
        id: 'llama3:8b',
        name: 'Llama 3 8B (Local)',
        provider: 'OLLAMA',
        contextWindow: 8192,
        capabilities: { vision: false, reasoning: false, toolUse: false, streaming: true },
        isLocal: true
    },
    {
        id: 'qwen2.5-coder:7b',
        name: 'Qwen 2.5 Coder 7B (Local)',
        provider: 'OLLAMA',
        contextWindow: 32000,
        capabilities: { vision: false, reasoning: false, toolUse: true, streaming: true },
        isLocal: true
    }
];

export function getModelById(id: string): ModelCatalogEntry | undefined {
    return modelCatalog.find(m => m.id === id);
}

export function getModelsByProvider(provider: string): ModelCatalogEntry[] {
    return modelCatalog.filter(m => m.provider === provider);
}

export function getModelsByCapability(capability: keyof ModelCatalogEntry['capabilities']): ModelCatalogEntry[] {
    return modelCatalog.filter(m => m.capabilities[capability]);
}
