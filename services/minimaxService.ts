/**
 * MINIMAX SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Central MiniMax integration for chat, embeddings, vision, and TTS.
 *
 * This adapter normalizes legacy repo defaults to the current MiniMax API
 * contract and supports both official API base domains because account keys
 * can be provisioned against different regions.
 */

import { costEstimator } from './costEstimator';
import { configLoader } from '../server/config/configLoader';
import * as fs from 'fs';
import * as path from 'path';

type MinimaxContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

interface MinimaxMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | MinimaxContentPart[];
    name?: string;
}

interface MinimaxOptions {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
}

interface MinimaxResponse {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices?: Array<{
        index?: number;
        message?: {
            role?: string;
            content?: string;
            name?: string;
            audio_content?: string;
            reasoning_details?: Array<{
                type?: string;
                text?: string;
            }>;
        };
        finish_reason?: string;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: {
            reasoning_tokens?: number;
        };
    };
    base_resp?: {
        status_code?: number;
        status_msg?: string;
    };
    error?: {
        message?: string;
        type?: string;
        http_code?: string;
    };
    vectors?: number[][];
    data?: {
        audio?: string;
        audio_url?: string;
    };
}

interface MinimaxVoice {
    voice_id: string;
    voice_name: string;
    description?: string[];
    created_time?: string;
}

interface JsonRequestOptions {
    authKeys?: string[];
    timeoutMs?: number;
}

const DEFAULT_MINIMAX_API_BASE = 'https://api.minimax.io/v1';
const FALLBACK_MINIMAX_API_BASES = [
    'https://api.minimax.io/v1',
    'https://api.minimaxi.com/v1'
];
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.5';
const DEFAULT_MINIMAX_TTS_MODEL = 'speech-2.8-hd';
const DEFAULT_MINIMAX_VOICE = 'English_radiant_girl';

const LEGACY_MODEL_ALIASES: Record<string, string> = {
    'abab-6.5s-chat': DEFAULT_MINIMAX_MODEL,
    'abab6.5s-chat': DEFAULT_MINIMAX_MODEL,
    'MiniMax-Text-01': DEFAULT_MINIMAX_MODEL
};

const LEGACY_VOICE_ALIASES: Record<string, string> = {
    'female-chatty': 'English_radiant_girl',
    'presenter_female': 'English_CalmWoman',
    'male-qn-qingse': 'English_magnetic_voiced_man'
};

function normalizeBaseUrl(baseUrl?: string): string {
    return (baseUrl || DEFAULT_MINIMAX_API_BASE).replace(/\/+$/, '');
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => !!value)));
}

function stripThinkingBlocks(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

class MinimaxService {
    private static instance: MinimaxService;
    private apiBase = DEFAULT_MINIMAX_API_BASE;
    private apiKey = '';
    private voiceApiKey = '';
    private groupId = '';
    private defaultModel = DEFAULT_MINIMAX_MODEL;
    private isInitialized = false;

    private readonly QUOTA_LIMIT = 500;
    private readonly QUOTA_WINDOW = 5 * 60 * 60 * 1000;
    private quotaFile = path.join(process.cwd(), 'data', 'minimax_quota.json');
    private requestTimestamps: number[] = [];
    private lastEmbeddingTime = 0;
    private readonly MIN_EMBEDDING_INTERVAL = 1000;

    private constructor() {
        this.loadConfig();
        this.loadQuota();
    }

    public static getInstance(): MinimaxService {
        if (!MinimaxService.instance) {
            MinimaxService.instance = new MinimaxService();
        }
        return MinimaxService.instance;
    }

    private loadConfig(): void {
        const config = configLoader.getConfig();
        const mmConfig = config.llm?.providers?.minimax;

        const configApiKey = mmConfig?.apiKey && mmConfig.apiKey !== 'LOADED_FROM_ENV'
            ? mmConfig.apiKey
            : '';

        this.apiKey = process.env.MINIMAX_API_KEY || configApiKey;
        this.voiceApiKey = process.env.MINIMAX_VOICE_API_KEY || this.apiKey;
        this.groupId = process.env.MINIMAX_GROUP_ID || mmConfig?.groupId || '';
        this.apiBase = normalizeBaseUrl(process.env.MINIMAX_BASE_URL || mmConfig?.baseUrl || this.apiBase);
        this.defaultModel = this.normalizeModel(process.env.MINIMAX_MODEL || mmConfig?.model);
        this.isInitialized = !!this.apiKey;

        if (this.isInitialized) {
            console.log(`[MINIMAX] ✅ Service initialized (${this.apiBase})`);
        } else {
            console.warn('[MINIMAX] ⚠️ No API key found in environment/config');
        }
    }

    public isAvailable(): boolean {
        return this.isInitialized && !!this.apiKey;
    }

    public normalizeModel(model?: string): string {
        return LEGACY_MODEL_ALIASES[model || ''] || model || DEFAULT_MINIMAX_MODEL;
    }

    public normalizeVoiceId(voiceId?: string): string {
        return LEGACY_VOICE_ALIASES[voiceId || ''] || voiceId || DEFAULT_MINIMAX_VOICE;
    }

    public getDefaultVoiceId(): string {
        return DEFAULT_MINIMAX_VOICE;
    }

    private getApiBases(): string[] {
        return uniqueStrings([
            process.env.MINIMAX_BASE_URL ? normalizeBaseUrl(process.env.MINIMAX_BASE_URL) : undefined,
            this.apiBase,
            ...FALLBACK_MINIMAX_API_BASES
        ]);
    }

    private hasChineseChars(text: string): boolean {
        return /[\u4e00-\u9fa5]/.test(text);
    }

    private getStructuredError(data: any): string | null {
        if (data?.error?.message) {
            return data.error.message;
        }

        if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
            return data.base_resp.status_msg || `MiniMax error ${data.base_resp.status_code}`;
        }

        return null;
    }

    private isAuthFailure(status: number, data: any, rawText: string): boolean {
        const normalized = `${rawText} ${this.getStructuredError(data) || ''}`.toLowerCase();
        return status === 401
            || status === 403
            || data?.base_resp?.status_code === 2049
            || data?.base_resp?.status_code === 1004
            || normalized.includes('invalid api key')
            || normalized.includes('login fail')
            || normalized.includes("authorization' field");
    }

    private shouldTryNextEndpoint(status: number, data: any, rawText: string): boolean {
        return this.isAuthFailure(status, data, rawText)
            || status === 404
            || status >= 500;
    }

    private async postJson(pathname: string, payload: Record<string, any>, options: JsonRequestOptions = {}): Promise<any> {
        const authKeys = uniqueStrings(options.authKeys && options.authKeys.length > 0
            ? options.authKeys
            : [this.apiKey]);

        if (authKeys.length === 0) {
            throw new Error('MiniMax API key is not configured');
        }

        let lastError: Error | null = null;

        for (const authKey of authKeys) {
            for (const baseUrl of this.getApiBases()) {
                try {
                    const response = await fetch(`${baseUrl}${pathname}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authKey}`
                        },
                        body: JSON.stringify(payload),
                        signal: AbortSignal.timeout(options.timeoutMs ?? 30000)
                    });

                    const rawText = await response.text();
                    let data: any = null;

                    try {
                        data = rawText ? JSON.parse(rawText) : null;
                    } catch {
                        data = null;
                    }

                    const structuredError = this.getStructuredError(data);
                    const isSuccessful = response.ok && !structuredError;

                    if (isSuccessful) {
                        this.apiBase = baseUrl;
                        return data;
                    }

                    const errorMessage = structuredError || rawText || `MiniMax request failed (${response.status})`;
                    if (this.shouldTryNextEndpoint(response.status, data, rawText)) {
                        lastError = new Error(errorMessage);
                        continue;
                    }

                    throw new Error(errorMessage);
                } catch (error: any) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    const isNetworkError = /fetch failed|network|econn|timeout/i.test(lastError.message);
                    if (isNetworkError) {
                        continue;
                    }

                    throw lastError;
                }
            }
        }

        throw lastError || new Error('MiniMax request failed after exhausting all configured endpoints');
    }

    public async generateCompletion(prompt: string, options: MinimaxOptions = {}): Promise<string> {
        return this.chat([{ role: 'user', content: prompt }], options);
    }

    private async requestChatCompletion(
        model: string,
        messages: MinimaxMessage[],
        temperature: number,
        maxTokens: number
    ): Promise<MinimaxResponse> {
        const data = await this.postJson('/chat/completions', {
            model,
            messages,
            temperature,
            max_completion_tokens: maxTokens,
            reasoning_split: true,
            stream: false
        }, { timeoutMs: 60000 }) as MinimaxResponse;

        if (data.usage) {
            costEstimator.trackTransaction(
                data.usage.prompt_tokens || 0,
                data.usage.completion_tokens || 0,
                model
            );
        }

        this.consumeQuota();
        return data;
    }

    public async chat(messages: MinimaxMessage[], options: MinimaxOptions = {}): Promise<string> {
        if (!this.isAvailable()) {
            throw new Error('[MINIMAX] Service not configured.');
        }

        if (!this.checkQuota()) {
            throw new Error('[MINIMAX] ⛔ 5-Hour Limit Reached (500 reqs). Please wait.');
        }

        const model = this.normalizeModel(options.model || this.defaultModel);
        const temperature = options.temperature ?? 0.7;
        const maxTokens = options.maxTokens ?? 4096;

        const systemMsg: MinimaxMessage = {
            role: 'system',
            content: 'You are an internal thought process. Output in English unless the user explicitly requests Spanish. Never output Chinese characters.'
        };

        const finalMessages = messages[0]?.role === 'system'
            ? messages
            : [systemMsg, ...messages];

        console.log(`[MINIMAX] 🚀 Generating with ${model} via ${this.apiBase}...`);

        try {
            let data = await this.requestChatCompletion(model, finalMessages, temperature, Math.max(maxTokens, 128));
            let content = stripThinkingBlocks(data.choices?.[0]?.message?.content || '');

            if (!content && data.choices?.[0]?.finish_reason === 'length') {
                const retryMaxTokens = Math.max(maxTokens * 2, 256);
                console.warn(`[MINIMAX] Empty final content after reasoning split. Retrying with ${retryMaxTokens} completion tokens.`);
                data = await this.requestChatCompletion(model, finalMessages, temperature, retryMaxTokens);
                content = stripThinkingBlocks(data.choices?.[0]?.message?.content || '');
            }

            if (this.hasChineseChars(content)) {
                console.warn('[MINIMAX] ⚠️ Chinese detected in final response.');
            }

            return content;
        } catch (error: any) {
            console.error('[MINIMAX] ❌ Request failed:', error.message);
            throw error;
        }
    }

    private loadQuota() {
        try {
            const dir = path.dirname(this.quotaFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(this.quotaFile)) {
                this.requestTimestamps = JSON.parse(fs.readFileSync(this.quotaFile, 'utf-8'));
                const now = Date.now();
                this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.QUOTA_WINDOW);
            }
        } catch (e) {
            console.warn('[MINIMAX] Failed to load quota file:', e);
            this.requestTimestamps = [];
        }
    }

    private saveQuota() {
        try {
            const now = Date.now();
            this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.QUOTA_WINDOW);
            fs.writeFileSync(this.quotaFile, JSON.stringify(this.requestTimestamps));
        } catch (e) {
            console.error('[MINIMAX] Failed to save quota:', e);
        }
    }

    private checkQuota(): boolean {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.QUOTA_WINDOW);

        if (this.requestTimestamps.length >= this.QUOTA_LIMIT) {
            console.warn(`[MINIMAX] ⛔ UPDATE QUOTA EXCEEDED (${this.requestTimestamps.length}/${this.QUOTA_LIMIT} in 5h). Switching to fallback.`);
            return false;
        }
        return true;
    }

    private consumeQuota() {
        this.requestTimestamps.push(Date.now());
        this.saveQuota();
    }

    public async getEmbedding(text: string): Promise<number[] | null> {
        if (!this.isAvailable()) return null;
        if (!this.checkQuota()) return null;

        const now = Date.now();
        const timeSinceLast = now - this.lastEmbeddingTime;
        if (timeSinceLast < this.MIN_EMBEDDING_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, this.MIN_EMBEDDING_INTERVAL - timeSinceLast));
        }
        this.lastEmbeddingTime = Date.now();

        try {
            const data = await this.postJson('/embeddings', {
                model: 'embo-01',
                texts: [text],
                type: 'db'
            }) as MinimaxResponse;

            this.consumeQuota();
            return data.vectors && data.vectors.length > 0 ? data.vectors[0] : null;
        } catch (error: any) {
            console.error('[MINIMAX] ❌ Embedding Failed:', error.message);
            return null;
        }
    }

    public async analyzeImage(prompt: string, base64Image: string): Promise<string> {
        if (!this.isAvailable()) {
            throw new Error('[MINIMAX] Service not configured.');
        }
        if (!this.checkQuota()) {
            throw new Error('[MINIMAX] ⛔ 5-Hour Limit Reached. Please wait.');
        }

        const data = await this.postJson('/chat/completions', {
            model: this.normalizeModel(this.defaultModel),
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: base64Image } }
                    ]
                }
            ],
            temperature: 0.1,
            max_completion_tokens: 2048,
            reasoning_split: true,
            stream: false
        }, { timeoutMs: 60000 }) as MinimaxResponse;

        this.consumeQuota();
        return stripThinkingBlocks(data.choices?.[0]?.message?.content || '');
    }

    public async listVoices(): Promise<Array<{ id: string; name: string }>> {
        if (!this.isAvailable()) return [];

        const data = await this.postJson('/get_voice', {
            voice_type: 'system'
        }, {
            authKeys: uniqueStrings([this.voiceApiKey, this.apiKey]),
            timeoutMs: 15000
        }) as { system_voice?: MinimaxVoice[] };

        return (data.system_voice || []).map((voice) => ({
            id: voice.voice_id,
            name: voice.voice_name
        }));
    }

    public async checkHealth(): Promise<boolean> {
        if (!this.isAvailable()) return false;

        try {
            const voices = await this.listVoices();
            return voices.length > 0;
        } catch {
            return false;
        }
    }

    public async generateSpeech(text: string, voiceId?: string): Promise<string | null> {
        if (!this.isAvailable()) return null;
        if (!this.checkQuota()) return null;

        const targetVoice = this.normalizeVoiceId(voiceId);

        console.log(`[MINIMAX] 🗣️ Generating Audio (Voice: ${targetVoice})...`);

        try {
            const data = await this.postJson('/t2a_v2', {
                model: DEFAULT_MINIMAX_TTS_MODEL,
                text,
                stream: false,
                subtitle_enable: false,
                voice_setting: {
                    voice_id: targetVoice,
                    speed: 1,
                    vol: 1,
                    pitch: 0
                },
                audio_setting: {
                    sample_rate: 32000,
                    bitrate: 128000,
                    format: 'mp3',
                    channel: 1
                },
                output_format: 'hex'
            }, {
                authKeys: uniqueStrings([this.voiceApiKey, this.apiKey]),
                timeoutMs: 120000
            }) as MinimaxResponse;

            if (!data.data?.audio) {
                console.error('[MINIMAX] Unexpected audio response format:', data);
                return null;
            }

            this.consumeQuota();

            const audioBuffer = Buffer.from(data.data.audio, 'hex');
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            const filename = `speech_mm_${Date.now()}.mp3`;
            const filePath = path.join(uploadDir, filename);
            fs.writeFileSync(filePath, audioBuffer);
            return `/uploads/${filename}`;
        } catch (error: any) {
            console.error('[MINIMAX] ❌ Audio generation failed:', error.message);
            return null;
        }
    }
}

export const minimaxService = MinimaxService.getInstance();
