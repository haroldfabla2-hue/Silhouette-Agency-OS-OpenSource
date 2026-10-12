/** Provider data is independent from transport. No secrets belong in definitions. */
export interface ModelProfile {
    tokenParameter?: 'max_tokens' | 'max_completion_tokens';
    omitTemperature?: boolean;
    systemRole?: 'system' | 'developer' | 'user';
    tools?: boolean;
}
export interface ProviderDefinition {
    id: string;
    transport: 'legacy' | 'openai-compatible';
    model: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    modelEnv?: string;
    baseUrlEnv?: string;
    discovery?: boolean;
    timeoutMs?: number;
    priority?: number;
    profiles?: Record<string, ModelProfile>;
}
export const builtInProviders: ProviderDefinition[] = [
    { id: 'MINIMAX', transport: 'legacy', model: 'MiniMax-M2.7-highspeed', priority: 10 },
    { id: 'GEMINI', transport: 'legacy', model: 'gemini-2.0-flash', priority: 20 },
    { id: 'GROQ', transport: 'legacy', model: 'llama-3.3-70b-versatile', priority: 30 },
    { id: 'DEEPSEEK', transport: 'legacy', model: 'deepseek-chat', priority: 40 },
    { id: 'OLLAMA', transport: 'legacy', model: 'qwen2.5-coder:7b', priority: 50 },
    // Kept explicitly selectable, preserving the previous fallback order.
    { id: 'ZHIPUAI', transport: 'legacy', model: 'glm-4-flash' },
    { id: 'NVIDIA', transport: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY', modelEnv: 'NVIDIA_MODEL', baseUrlEnv: 'NVIDIA_BASE_URL', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', discovery: true, priority: 60 },
    { id: 'OPENROUTER', transport: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', model: 'openai/gpt-4o-mini', discovery: true, priority: 70 }
];
export class ProviderRegistry {
    private entries = new Map<string, ProviderDefinition>();
    constructor(definitions: ProviderDefinition[] = builtInProviders) {
        for (const definition of definitions) this.register(definition);
    }
    register(definition: ProviderDefinition): void {
        if (!/^[A-Z][A-Z0-9_-]*$/.test(definition.id) || !definition.model?.trim()) throw new Error('Invalid provider id/model');
        if (!['legacy', 'openai-compatible'].includes(definition.transport)) throw new Error('Unknown provider transport');
        const existing = this.entries.get(definition.id);
        if (existing?.transport === 'legacy') throw new Error(`Cannot replace legacy provider ${definition.id}`);
        if (definition.transport === 'openai-compatible') {
            const url = new URL(definition.baseUrl || '');
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid provider base URL');
            if (!definition.apiKeyEnv || !/^[A-Z][A-Z0-9_]*$/.test(definition.apiKeyEnv)) throw new Error('apiKeyEnv must name an environment variable');
        }
        this.entries.set(definition.id, structuredClone(definition));
    }
    get(id: string): ProviderDefinition | undefined { return this.entries.get(id); }
    list(): ProviderDefinition[] { return [...this.entries.values()]; }
    order(): string[] {
        return this.list().filter(p => p.priority !== undefined).sort((a, b) => a.priority! - b.priority!).map(p => p.id);
    }
    /** Configuration is trusted server-side data, never taken from prompts or discovery responses. */
    static fromEnvironment(): ProviderRegistry {
        const registry = new ProviderRegistry();
        if (process.env.LLM_PROVIDERS_JSON) {
            const entries = JSON.parse(process.env.LLM_PROVIDERS_JSON);
            if (!Array.isArray(entries)) throw new Error('LLM_PROVIDERS_JSON must be an array');
            for (const entry of entries) registry.register(entry);
        }
        return registry;
    }
}
