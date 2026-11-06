/**
 * Legacy geminiService compatibility layer.
 *
 * The rest of the codebase still imports the historical Gemini API surface.
 * This adapter preserves that surface while routing requests through the
 * currently supported providers without creating import cycles.
 */

import { llmGateway } from './llmGateway';
import { minimaxService } from './minimaxService';

type CompletionOptions = {
    communicationLevel?: unknown;
    images?: string[];
    temperature?: number;
    model?: string;
    maxTokens?: number;
    systemPrompt?: string;
    preferredProvider?: 'GEMINI' | 'GROQ' | 'DEEPSEEK' | 'OLLAMA' | 'MINIMAX';
    skipProviders?: string[];
};

type AgentResponse = {
    output: string;
    thoughts: string[];
    usage: number;
    qualityScore?: number;
};

let runtimeApiKey = process.env.GEMINI_API_KEY || '';

const logger = {
    info: (msg: string, data?: unknown) => console.log(`[GEMINI_SERVICE] ${msg}`, data ?? ''),
    warn: (msg: string, data?: unknown) => console.warn(`[GEMINI_SERVICE] ${msg}`, data ?? ''),
    error: (msg: string, data?: unknown) => console.error(`[GEMINI_SERVICE] ${msg}`, data ?? ''),
};

function hasConfiguredProvider(): boolean {
    return minimaxService.isAvailable() || Boolean(runtimeApiKey);
}

function normalizeImageData(image: string): string {
    if (!image) return image;
    if (image.startsWith('data:')) return image;
    const payload = image.includes(',') ? image.split(',')[1] : image;
    return `data:image/png;base64,${payload}`;
}

function safeJsonParse<T>(text: string, fallback: T): T {
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/) || clean.match(/\[[\s\S]*\]/);
    if (!match) return fallback;

    try {
        return JSON.parse(match[0]) as T;
    } catch {
        return fallback;
    }
}

function fallbackEmbedding(text: string): number[] {
    const dimension = 512;
    const vector = new Array(dimension).fill(0);
    const seedText = text || ' ';

    for (let i = 0; i < seedText.length; i += 1) {
        const code = seedText.charCodeAt(i);
        const index = (code + i * 31) % dimension;
        vector[index] += (code % 97) / 97;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
}

function buildAgentPrompt(
    agentName: string,
    agentRole: string,
    category: string,
    task: string,
    context?: unknown,
    previousOutput?: string | null,
    stage?: unknown,
    capabilities?: unknown[],
    communicationLevel?: unknown
): string {
    const contextBlock = context ? `\nContext:\n${JSON.stringify(context).slice(0, 12000)}` : '';
    const previousBlock = previousOutput ? `\nPrevious output:\n${previousOutput}` : '';
    const capabilityBlock = capabilities && capabilities.length > 0
        ? `\nCapabilities: ${capabilities.join(', ')}`
        : '';

    return [
        `You are ${agentName}, acting as ${agentRole}.`,
        `Category: ${category}`,
        `Stage: ${String(stage || 'EXECUTION')}`,
        `Communication Level: ${String(communicationLevel || 'USER_FACING')}`,
        capabilityBlock,
        contextBlock,
        previousBlock,
        '',
        'Task:',
        task,
        '',
        'Return a direct, useful answer.',
    ].join('\n');
}

function makeThoughts(output: string): string[] {
    if (!output) {
        return ['Provider returned an empty response.'];
    }

    return [
        'Compatibility layer executed successfully.',
        `Generated ${output.length} characters of output.`,
    ];
}

async function completeWithProviders(prompt: string, options: CompletionOptions = {}): Promise<string> {
    if (minimaxService.isAvailable()) {
        if (options.images && options.images.length > 0) {
            return minimaxService.analyzeImage(prompt, normalizeImageData(options.images[0]));
        }

        return minimaxService.generateCompletion(prompt, {
            model: options.model,
            maxTokens: options.maxTokens,
            temperature: options.temperature,
        });
    }

    const skipProviders = new Set(options.skipProviders || []);
    skipProviders.add('GEMINI');

    const result = await llmGateway.complete(prompt, {
        maxTokens: options.maxTokens,
        preferredProvider: options.preferredProvider === 'GEMINI'
            ? undefined
            : options.preferredProvider,
        skipProviders: Array.from(skipProviders),
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
    });

    return result.text;
}

export function configureGenAI(key: string) {
    runtimeApiKey = key || runtimeApiKey;
    if (key && !process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = key;
    }
    logger.info('configureGenAI compatibility hook updated runtime key state');
}

export async function generateText(prompt: string, options: CompletionOptions = {}): Promise<string> {
    try {
        return await completeWithProviders(prompt, options);
    } catch (error: any) {
        logger.error('generateText failed', error?.message || error);
        return 'Error: No LLM provider is currently available.';
    }
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
    try {
        if (minimaxService.isAvailable()) {
            const embedding = await minimaxService.getEmbedding(text);
            if (embedding && embedding.length > 0) {
                return embedding;
            }
        }
    } catch (error: any) {
        logger.warn('generateEmbedding falling back to deterministic local vector', error?.message || error);
    }

    return fallbackEmbedding(text);
}

export async function generateAgentResponse(
    agentName: string,
    agentRole: string,
    category: string,
    task: string,
    previousOutput: string | null,
    introspectionDepth: unknown,
    currentStage: unknown,
    projectContext?: unknown,
    sensoryData: unknown = {},
    agentCapabilities: unknown[] = [],
    communicationLevel: unknown = 'USER_FACING',
    modelOverride?: string
): Promise<AgentResponse> {
    const prompt = buildAgentPrompt(
        agentName,
        agentRole,
        category,
        task,
        { projectContext, sensoryData, introspectionDepth },
        previousOutput,
        currentStage,
        agentCapabilities,
        communicationLevel
    );

    const output = await generateText(prompt, { model: modelOverride });

    return {
        output,
        thoughts: makeThoughts(output),
        usage: output.length,
        qualityScore: output ? 80 : 0,
    };
}

export async function* generateAgentResponseStream(
    agentName: string,
    agentRole: string,
    category: string,
    task: string,
    context: unknown,
    introspectionDepth: unknown,
    currentStage: unknown,
    agentCapabilities: unknown[] = [],
    config: CompletionOptions = {},
    tools: unknown = {},
    communicationLevel: unknown = 'USER_FACING'
): AsyncGenerator<string, void, unknown> {
    const prompt = buildAgentPrompt(
        agentName,
        agentRole,
        category,
        task,
        { context, introspectionDepth, tools },
        null,
        currentStage,
        agentCapabilities,
        communicationLevel
    );

    const output = await generateText(prompt, {
        maxTokens: config.maxTokens,
        model: config.model || config.modelOverride,
        preferredProvider: config.preferredProvider,
        systemPrompt: config.systemPrompt,
        temperature: config.temperature,
    });

    if (!output) {
        yield '[ERROR] Empty response from provider';
        return;
    }

    const chunks = output.match(/.{1,160}(\s|$)/g) || [output];
    for (const chunk of chunks) {
        yield chunk;
    }
}

export async function analyzeSystemHealth(metrics: unknown): Promise<{ score: number; reasoning: string }> {
    const prompt = [
        'Evaluate these system metrics and summarize health as JSON.',
        'Return exactly: {"score": number, "reasoning": "string"}',
        JSON.stringify(metrics),
    ].join('\n\n');

    const response = await generateText(prompt, { temperature: 0.2 });
    return safeJsonParse(response, {
        score: 75,
        reasoning: 'Automated health analysis unavailable. Returning neutral default.',
    });
}

export async function generateShotlist(
    objective: string,
    brand: any,
    rules: string
): Promise<any | null> {
    const prompt = `
Create a campaign shotlist as JSON.

Objective: ${objective}
Brand: ${brand?.name || 'Unknown'}
Primary emotion: ${brand?.manifesto?.emotionalSpectrum?.primary || 'Unknown'}
Forbidden elements: ${(brand?.manifesto?.emotionalSpectrum?.forbidden || []).join(', ')}
Rules: ${rules}

Return exactly:
{
  "id": "campaign_id",
  "name": "Campaign name",
  "objective": "summary",
  "platform": "Instagram Reels",
  "shotlist": [
    {
      "id": "shot_1",
      "description": "visual description",
      "angle": "Eye Level",
      "lighting": "Natural",
      "lens": "35mm",
      "movement": "Static",
      "productPlacement": "Center",
      "audioCue": "Subtle ambient"
    }
  ]
}`.trim();

    const response = await generateText(prompt, { temperature: 0.4 });
    const fallback = {
        id: 'campaign_fallback',
        name: `${brand?.name || 'Brand'} Campaign`,
        objective,
        platform: 'Instagram Reels',
        shotlist: [
            {
                id: 'shot_1',
                description: `${objective} hero frame`,
                angle: 'Eye Level',
                lighting: 'Natural',
                lens: '35mm',
                movement: 'Static',
                productPlacement: 'Center',
                audioCue: 'Ambient texture',
            },
            {
                id: 'shot_2',
                description: `${objective} product detail`,
                angle: 'Close Up',
                lighting: 'Softbox',
                lens: '85mm',
                movement: 'Slow push',
                productPlacement: 'Foreground',
                audioCue: 'Soft mechanical clicks',
            },
            {
                id: 'shot_3',
                description: `${objective} lifestyle environment`,
                angle: 'Wide',
                lighting: 'Golden hour',
                lens: '24mm',
                movement: 'Tracking',
                productPlacement: 'Subtle',
                audioCue: 'Cinematic swell',
            },
        ],
    };

    return safeJsonParse(response, fallback);
}

export async function analyzeImage(
    imageUrl: string,
    prompt: string,
    brandContext: any
): Promise<any | null> {
    const fallback = {
        score: 0,
        reasoning: 'Image analysis unavailable.',
        feedback: 'Manual review required.',
        pass: false,
    };

    try {
        const imageResp = await fetch(imageUrl);
        if (!imageResp.ok) {
            throw new Error(`Failed to fetch image (${imageResp.status})`);
        }

        const arrayBuffer = await imageResp.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString('base64');

        const analysisPrompt = `
You are a strict creative QA reviewer.

Brand: ${brandContext?.name || 'Unknown'}
Primary emotion: ${brandContext?.manifesto?.emotionalSpectrum?.primary || 'Unknown'}
Forbidden elements: ${(brandContext?.manifesto?.emotionalSpectrum?.forbidden || []).join(', ')}
Original prompt: ${prompt}

Return exactly:
{
  "score": 0,
  "reasoning": "brief explanation",
  "feedback": "specific fix guidance",
  "pass": false
}`.trim();

        const response = await createCompletion(analysisPrompt, {
            images: [base64Image],
            temperature: 0.2,
        });

        return safeJsonParse(response, fallback);
    } catch (error: any) {
        logger.error('analyzeImage failed', error?.message || error);
        return fallback;
    }
}

export async function createCompletion(prompt: string, options: CompletionOptions = {}): Promise<string> {
    return generateText(prompt, options);
}

export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
    const prompt = [
        'Transcribe this audio exactly. Return only the transcription.',
        `Mime type: ${mimeType}`,
    ].join('\n');

    try {
        return await createCompletion(prompt, {
            images: [normalizeImageData(base64Audio)],
            temperature: 0.1,
        });
    } catch (error: any) {
        logger.error('transcribeAudio failed', error?.message || error);
        return '[Transcription failed: No speech-to-text provider is currently available]';
    }
}

export function hasApiKey(): boolean {
    return hasConfiguredProvider();
}

export const geminiService = {
    analyzeImage,
    analyzeSystemHealth,
    configureGenAI,
    createCompletion,
    generateAgentResponse,
    generateAgentResponseStream,
    generateEmbedding,
    generateShotlist,
    generateText,
    hasApiKey,
    transcribeAudio,
};

export default geminiService;
