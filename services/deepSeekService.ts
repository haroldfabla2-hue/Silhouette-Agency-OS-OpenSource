/**
 * DEEPSEEK SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Specialized LLM service for coding tasks using DeepSeek API.
 * 
 * DeepSeek advantages:
 * - 98% HumanEval score (best for code)
 * - 128K context window
 * - ~200x cheaper than GPT-4
 * - No strict rate limits published
 * 
 * Pricing ($USD per 1M tokens):
 * - DeepSeek V3: $0.28 input / $0.42 output
 * - DeepSeek Coder: $0.14 input / $0.28 output
 */

import { costEstimator } from './costEstimator';

interface DeepSeekMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface DeepSeekOptions {
    model?: 'deepseek-chat' | 'deepseek-coder' | 'deepseek-reasoner' | string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
}

interface DeepSeekResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

class DeepSeekService {
    private static instance: DeepSeekService;
    private apiBase = 'https://api.deepseek.com/v1';
    private apiKey: string = '';
    private isInitialized = false;

    private constructor() {
        this.loadApiKey();
    }

    public static getInstance(): DeepSeekService {
        if (!DeepSeekService.instance) {
            DeepSeekService.instance = new DeepSeekService();
        }
        return DeepSeekService.instance;
    }

    private loadApiKey(): void {
        this.apiKey = process.env.DEEPSEEK_API_KEY || '';
        this.isInitialized = !!this.apiKey;

        if (this.isInitialized) {
            console.log('[DEEPSEEK] ✅ Service initialized with API key');
        } else {
            console.warn('[DEEPSEEK] ⚠️ No API key found. Set DEEPSEEK_API_KEY in environment.');
        }
    }

    /**
     * Check if DeepSeek is available
     */
    public isAvailable(): boolean {
        return this.isInitialized && !!this.apiKey;
    }

    /**
     * Generate completion for coding tasks
     */
    public async generateCompletion(
        prompt: string,
        options: DeepSeekOptions = {}
    ): Promise<string> {
        if (!this.isAvailable()) {
            throw new Error('[DEEPSEEK] Service not available. Set DEEPSEEK_API_KEY.');
        }

        const {
            model = 'deepseek-coder',
            maxTokens = 2048,
            temperature = 0.3  // Lower temp for code accuracy
        } = options;

        const messages: DeepSeekMessage[] = [
            { role: 'user', content: prompt }
        ];

        return this.chat(messages, { model, maxTokens, temperature });
    }

    /**
     * Chat completion with message history
     */
    public async chat(
        messages: DeepSeekMessage[],
        options: DeepSeekOptions = {}
    ): Promise<string> {
        if (!this.isAvailable()) {
            throw new Error('[DEEPSEEK] Service not available. Set DEEPSEEK_API_KEY.');
        }

        const {
            model = 'deepseek-coder',
            maxTokens = 2048,
            temperature = 0.3
        } = options;

        console.log(`[DEEPSEEK] 🚀 Generating with ${model}...`);

        try {
            const response = await fetch(`${this.apiBase}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: maxTokens,
                    temperature,
                    stream: false
                })
            });

            if (!response.ok) {
                const error = await response.text();
                console.error('[DEEPSEEK] API Error:', error);
                throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
            }

            const data: DeepSeekResponse = await response.json();

            // Track costs
            if (data.usage) {
                costEstimator.trackTransaction(
                    data.usage.prompt_tokens,
                    data.usage.completion_tokens,
                    model === 'deepseek-coder' ? 'deepseek-coder' : 'deepseek-v3'
                );
                console.log(`[DEEPSEEK] 📊 Tokens: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`);
            }

            const content = data.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error('[DEEPSEEK] No content in response');
            }

            console.log('[DEEPSEEK] ✅ Generation complete');
            return content;

        } catch (error: any) {
            console.error('[DEEPSEEK] ❌ Request failed:', error.message);
            throw error;
        }
    }

    /**
     * Generate code with system prompt for better results
     */
    public async generateCode(
        task: string,
        context?: string,
        language?: string
    ): Promise<string> {
        const systemPrompt = `You are an expert ${language || 'TypeScript'} developer. 
Generate clean, well-documented, production-ready code.
Follow best practices and include error handling.
${context ? `\nContext:\n${context}` : ''}`;

        const messages: DeepSeekMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: task }
        ];

        return this.chat(messages, {
            model: 'deepseek-coder',
            temperature: 0.2  // Even lower for code generation
        });
    }

    /**
     * Analyze and suggest improvements for code
     */
    public async analyzeCode(
        code: string,
        focusArea?: 'performance' | 'security' | 'readability' | 'bugs'
    ): Promise<string> {
        const prompt = `Analyze this code${focusArea ? ` focusing on ${focusArea}` : ''}.
Provide specific, actionable improvements.

\`\`\`
${code}
\`\`\``;

        return this.generateCompletion(prompt, {
            model: 'deepseek-coder',
            temperature: 0.4
        });
    }
}

export const deepSeekService = DeepSeekService.getInstance();
