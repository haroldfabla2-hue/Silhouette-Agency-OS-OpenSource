import type { ModelProfile, ProviderDefinition } from './providerRegistry';
export interface ChatMessage {
    role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; }
export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    signal?: AbortSignal;
    tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters: Record<string, unknown> } }>;
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}
export interface ChatResult {
    text: string;
    toolCalls: ToolCall[];
    model: string;
    finishReason?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}
export type ChatEvent = { type: 'text'; text: string } | { type: 'tool'; index: number; delta: Partial<ToolCall> } | { type: 'finish'; reason: string | null };
export interface ModelDiscovery { ids: string[]; source: 'remote' | 'configured'; error?: string; capabilities: 'unknown'; }
export class OpenAICompatibleClient {
    private cache = new Map<string, { expires: number; value: ModelDiscovery }>();
    constructor(private env: NodeJS.ProcessEnv = process.env, private fetcher: typeof fetch = fetch) {}
    configured(provider: ProviderDefinition): boolean { return !!this.env[provider.apiKeyEnv!]; }
    model(provider: ProviderDefinition, explicit?: string): string {
        return explicit || (provider.modelEnv && this.env[provider.modelEnv]) || provider.model;
    }
    private url(provider: ProviderDefinition, path: string): string {
        const base = (provider.baseUrlEnv && this.env[provider.baseUrlEnv]) || provider.baseUrl!;
        const url = new URL(base);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid provider URL');
        return base.replace(/\/$/, '') + path;
    }
    private headers(provider: ProviderDefinition): Record<string, string> {
        const key = this.env[provider.apiKeyEnv!];
        if (!key) throw new Error(`${provider.id}: credential not configured`);
        return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    }
    private signal(provider: ProviderDefinition, options: ChatOptions): AbortSignal {
        const timeout = options.timeout ?? provider.timeoutMs ?? 30000;
        if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid request timeout');
        const deadline = AbortSignal.timeout(timeout);
        return options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
    }
    private body(provider: ProviderDefinition, messages: ChatMessage[], options: ChatOptions, stream: boolean): Record<string, unknown> {
        const model = this.model(provider, options.model);
        const profile: ModelProfile = provider.profiles?.[model] || {};
        if (options.tools?.length && profile.tools === false) throw new Error(`${provider.id}: tools disabled for selected model`);
        const mapped = messages.map(m => m.role === 'system' && profile.systemRole ? { ...m, role: profile.systemRole } : m);
        return {
            model, messages: mapped, stream,
            ...(!profile.omitTemperature && options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.maxTokens !== undefined ? { [profile.tokenParameter || 'max_tokens']: options.maxTokens } : {}),
            ...(options.tools?.length ? { tools: options.tools, ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}) } : {})
        };
    }
    private async request(provider: ProviderDefinition, messages: ChatMessage[], options: ChatOptions, stream: boolean): Promise<Response> {
        const response = await this.fetcher(this.url(provider, '/chat/completions'), {
            method: 'POST', headers: this.headers(provider), body: JSON.stringify(this.body(provider, messages, options, stream)), signal: this.signal(provider, options), redirect: 'error'
        });
        // Do not echo vendor response bodies: they may contain keys, prompts or private content.
        if (!response.ok) { await response.body?.cancel(); throw new Error(`${provider.id}: HTTP ${response.status}`); }
        return response;
    }
    async complete(provider: ProviderDefinition, messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
        const response = await this.request(provider, messages, options, false);
        let data: any;
        try { data = await response.json(); } catch { throw new Error(`${provider.id}: invalid JSON response`); }
        const choice = data.choices?.[0];
        if (!choice?.message || typeof choice.message !== 'object') throw new Error(`${provider.id}: invalid chat response`);
        const text = choice.message.content;
        const toolCalls = choice.message.tool_calls || [];
        if ((text !== null && text !== undefined && typeof text !== 'string') || !Array.isArray(toolCalls)) throw new Error(`${provider.id}: invalid message`);
        for (const call of toolCalls) {
            if (typeof call.id !== 'string' || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') throw new Error(`${provider.id}: invalid tool call`);
        }
        if (!text && !toolCalls.length) throw new Error(`${provider.id}: empty response`);
        return { text: text || '', toolCalls, model: data.model || this.model(provider, options.model), finishReason: choice.finish_reason,
            usage: data.usage ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens } : undefined };
    }
    async *stream(provider: ProviderDefinition, messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<ChatEvent> {
        const response = await this.request(provider, messages, options, true);
        if (!response.body) throw new Error(`${provider.id}: missing stream body`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', finished = false;
        const parse = (event: string): ChatEvent[] | 'done' => {
            const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!payload) return [];
            if (payload.trim() === '[DONE]') return 'done';
            let data: any;
            try { data = JSON.parse(payload); } catch { throw new Error(`${provider.id}: invalid SSE JSON`); }
            if (data.error) throw new Error(`${provider.id}: stream API error`);
            const choice = data.choices?.[0];
            if (!choice) return [];
            const out: ChatEvent[] = [];
            if (typeof choice.delta?.content === 'string' && choice.delta.content) out.push({ type: 'text', text: choice.delta.content });
            for (const tool of choice.delta?.tool_calls || []) out.push({ type: 'tool', index: tool.index, delta: tool });
            if (choice.finish_reason != null) { finished = true; out.push({ type: 'finish', reason: choice.finish_reason }); }
            return out;
        };
        try {
            while (true) {
                const { value, done } = await reader.read();
                buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
                buffer = buffer.replace(/\r\n/g, '\n');
                if (buffer.length > 1024 * 1024) throw new Error(`${provider.id}: oversized SSE event`);
                let boundary: number;
                while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                    const events = parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
                    if (events === 'done') return;
                    yield* events;
                }
                if (done) {
                    if (buffer.trim()) { const events = parse(buffer); if (events === 'done') return; yield* events; }
                    if (!finished) throw new Error(`${provider.id}: truncated stream`);
                    return;
                }
            }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    async discover(provider: ProviderDefinition, refresh = false): Promise<ModelDiscovery> {
        const key = provider.id + ':' + this.url(provider, '/models') + ':' + this.model(provider);
        const cached = this.cache.get(key);
        if (!refresh && cached && cached.expires > Date.now()) return structuredClone(cached.value);
        let result: ModelDiscovery = { ids: [this.model(provider)], source: 'configured', capabilities: 'unknown' };
        if (provider.discovery !== false && this.configured(provider)) {
            try {
                const response = await this.fetcher(this.url(provider, '/models'), { headers: this.headers(provider), signal: AbortSignal.timeout(provider.timeoutMs ?? 10000), redirect: 'error' });
                if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
                const data = await response.json();
                const ids: string[] = [...new Set<string>((data.data || []).filter((m: any) => typeof m.id === 'string' && m.id).map((m: any) => m.id))];
                if (!ids.length) throw new Error('Invalid/empty model list');
                result = { ids, source: 'remote', capabilities: 'unknown' };
            } catch { result.error = 'Discovery unavailable; using configured model'; }
        }
        this.cache.set(key, { value: result, expires: Date.now() + (result.source === 'remote' ? 300000 : 30000) });
        return structuredClone(result);
    }
}
