import { tavilyService } from "../search/tavilyService";
import { imageFactory } from "../media/imageFactory";
import { elevenLabsService } from "../media/elevenLabsService";
import { videoFactory } from "../media/videoFactory";
import { systemBus } from "../systemBus";
import { SystemProtocol } from "../../types";
import path from 'path';

export interface CreativeCampaign {
    id: string;
    brief: string;
    researchSummary: string;
    assets: {
        images: string[];
        audio: string[];
        videos: string[];
    };
    status: 'PLANNING' | 'PRODUCTION' | 'COMPLETED';
}

class CreativeDirectorSkill {

    public async execute(brief: string): Promise<CreativeCampaign> {
        console.log(`[CreativeDirector] 🎬 ACTION! Starting Campaign: "${brief}"`);

        // 1. Research Phase
        console.log("[CreativeDirector] 🕵️ Searching for visual trends & context...");
        const researchResults = await tavilyService.searchContext(`visual style trends and imagery for: ${brief}`, 3);

        const contextSummary = researchResults.map(r => r.content).join("\n");
        console.log(`[CreativeDirector] 🧠 Context Acquired: ${contextSummary.substring(0, 50)}...`);

        // 2. Ideation (Simplified for V1: Direct Translation)
        // In V2, we would ask an LLM to generate a storyboard here.
        // For now, we derive propmts directly.

        const imagePrompt = `Cinematic shot, ${brief}, trending on artstation, ${contextSummary.substring(0, 100)}`;
        const videoAction = brief;

        const campaign: CreativeCampaign = {
            id: `camp_${Date.now()}`,
            brief,
            researchSummary: contextSummary,
            assets: { images: [], audio: [], videos: [] },
            status: 'PRODUCTION'
        };

        // 3. Production Phase (Parallel Execution)
        try {
            // A. Image Generation (NanoBanana/Flux)
            console.log("[CreativeDirector] 🎨 Commencing Image Generation...");
            const imageAsset = await imageFactory.createAsset({
                prompt: imagePrompt,
                style: 'PHOTOREALISTIC',
                aspectRatio: '16:9'
            });

            if (imageAsset) campaign.assets.images.push(imageAsset.url);

            // B. Voice Generation (ElevenLabs)
            console.log("[CreativeDirector] 🎙️ Recording Voiceover...");
            const script = `Introducing ${brief}. Experience the future.`;
            // Save to tmp or local public dir
            const audioFilename = `vo_${campaign.id}.mp3`;
            const audioPath = path.join(process.cwd(), 'data', 'media', audioFilename); // Ensure this dir exists

            const generatedAudioPath = await elevenLabsService.generateSpeech(script, audioPath);
            if (generatedAudioPath) campaign.assets.audio.push(generatedAudioPath);

            // C. Video Generation (Local Async Queue)
            // We use the generated image if available for I2V, else T2V
            console.log("[CreativeDirector] 🎥 Queuing Location Video Render...");
            const sourceImage = campaign.assets.images.length > 0 ? campaign.assets.images[0] : undefined;

            // Note: createAsset returns a URL, but for local use we might need the path if it's local?
            // Replicate returns a URL. Wan Worker handles URLs?
            // worker_wan.py uses `diffusers.utils.load_image` which supports URLs.

            const videoJob = await videoFactory.createVideo(videoAction, 4, sourceImage);
            if (videoJob) campaign.assets.videos.push(videoJob.url); // This is the Ticket ID

            campaign.status = 'COMPLETED';
            console.log("[CreativeDirector] ✅ CUT! Campaign Wrap.");

            // Notify UI
            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                thoughts: [
                    `[CREATIVE_DIRECTOR] Campaign Generated!`,
                    `Visuals: ${campaign.assets.images.length}`,
                    `Audio: ${campaign.assets.audio.length}`,
                    `Video Job: ${videoJob?.url || 'None'}`
                ],
                source: 'Creative_Director'
            });

        } catch (error: any) {
            // A denied effect must not be swallowed into a generic failure
            // that later logic could retry: propagate the typed denial.
            if (error?.code === 'EFFECT_DENIED') throw error;
            console.error("[CreativeDirector] 💥 Production Error:", error);
        }

        return campaign;
    }

    public async generateVisual(prompt: string): Promise<string | null> {
        console.log(`[CreativeDirector] 🎨 Granular Image Request: "${prompt}"`);
        try {
            const imageAsset = await imageFactory.createAsset({
                prompt: prompt,
                style: 'PHOTOREALISTIC',
                aspectRatio: '16:9'
            });
            if (imageAsset) {
                console.log(`[CreativeDirector] ✅ Image Created: ${imageAsset.url}`);
                systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                    thoughts: [`[CREATIVE_DIRECTOR] Generated Image: ${imageAsset.url}`],
                    source: 'Creative_Director'
                });
                return imageAsset.url;
            }
        } catch (e: any) {
            if (e?.code === 'EFFECT_DENIED') throw e;
            console.error("[CreativeDirector] Image Gen Failed:", e);
        }
        return null;
    }

    public async generateMotion(prompt: string, imageContext?: string, engine: 'WAN' | 'SVD' | 'ANIMATEDIFF' = 'WAN'): Promise<string | null> {
        console.log(`[CreativeDirector] 🎥 Granular Video Request: "${prompt}" (Engine: ${engine})`);
        try {
            // If imageContext is a URL/Path, use it.
            const videoJob = await videoFactory.createVideo(prompt, 4, imageContext, engine);
            if (videoJob) {
                console.log(`[CreativeDirector] ✅ Video Queued: ${videoJob.url}`);
                systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                    thoughts: [`[CREATIVE_DIRECTOR] Queued Video Job (${engine}): ${videoJob.url}`],
                    source: 'Creative_Director'
                });
                return videoJob.url;
            }
        } catch (e: any) {
            if (e?.code === 'EFFECT_DENIED') throw e;
            console.error("[CreativeDirector] Video Gen Failed:", e);
        }
        return null;
    }
    public async checkInbox() {
        // Poll for messages addressed to 'mkt-lead'
        const messages = await systemBus.checkMailbox('mkt-lead');
        if (messages.length === 0) return;

        console.log(`[CreativeDirector] 📬 Processing ${messages.length} new messages.`);

        for (const msg of messages) {
            try {
                if (msg.protocol === SystemProtocol.TASK_ASSIGNMENT) {
                    const { taskType, context } = msg.payload;
                    console.log(`[CreativeDirector] 📨 Received Task: ${taskType}`);

                    // [SECURITY] Deferred work carries NO authority: every
                    // wallet-bearing piece below gates itself at the provider
                    // boundary (human confirmation when no grant exists).
                    let result: any = null;

                    if (taskType === 'GENERATE_CAMPAIGN') {
                        result = await this.execute(context.brief);
                    }
                    else if (taskType === 'GENERATE_IMAGE') {
                        // Context usually has { prompt }
                        const prompt = context.prompt || context.brief;
                        result = await this.generateVisual(prompt);
                    }
                    else if (taskType === 'GENERATE_VIDEO') {
                        const prompt = context.prompt || context.brief;
                        result = await this.generateMotion(prompt, context.imageContext, context.engine);
                    }

                    // Reply if sender is expecting one (and it's not a fire-and-forget system message)
                    if (msg.senderId && msg.type === 'REQUEST') {
                        systemBus.send({
                            id: crypto.randomUUID(),
                            traceId: msg.traceId,
                            senderId: 'mkt-lead',
                            targetId: msg.senderId,
                            type: 'RESPONSE',
                            protocol: SystemProtocol.TASK_COMPLETION, // Or Generic Response
                            payload: { result, correlationId: msg.payload.correlationId },
                            timestamp: Date.now(),
                            priority: 'NORMAL'
                        });
                    }
                }
            } catch (err) {
                console.error(`[CreativeDirector] ❌ Error processing message ${msg.id}:`, err);
            }
        }
    }
}

export const creativeDirector = new CreativeDirectorSkill();
