
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { minimaxService } from './minimaxService'; // Inject Minimax TTS

export interface VoiceConfig {
    enabled: boolean;
    autoSpeak: boolean;
    voiceId?: string;
    volume: number;
    provider: 'local' | 'minimax'; // NEW PROXY
}

export class TTSService {
    private static instance: TTSService;
    private pythonEngineUrl = process.env.VOICE_ENGINE_URL || 'http://localhost:8100';
    private isEngineAwake = false;
    private backgroundStopped = false;
    private healthTimer: ReturnType<typeof setInterval> | null = null;
    private healthControllers = new Set<AbortController>();
    private healthRequests = new Set<Promise<void>>();
    private initialConfig: Promise<void>;
    private initialHealth: Promise<void>;
    private backgroundReady: Promise<void>;
    private healthFailures: unknown[] = [];
    private backgroundStop: Promise<void> | null = null;

    // Config default
    private config: VoiceConfig = {
        enabled: true,
        autoSpeak: false,
        volume: 1.0,
        provider: 'minimax' // Set Minimax as default provider to save VRAM
    };

    private constructor() {
        console.log('[TTS] Service Initialized. Connecting to Voice Engine...');
        // Preserve automatic bootstrap and the existing health-check cadence.
        this.initialConfig = this.loadConfig();
        this.initialHealth = this.checkEngineHealth();
        // Keep each owned operation, not only the fail-fast aggregate.
        void this.initialConfig.catch(error => {
            console.error('[TTS] Initial config load failed', error);
        });
        void this.initialHealth.catch(error => {
            console.error('[TTS] Initial health check failed', error);
        });
        this.backgroundReady = Promise.all([
            this.initialConfig,
            this.initialHealth
        ]).then(() => undefined);
        void this.backgroundReady.catch(error => {
            console.error('[TTS] Background initialization failed', error);
        });
        this.healthTimer = setInterval(() => {
            if (!this.backgroundStopped) {
                void this.checkEngineHealth().catch(error => {
                    this.healthFailures.push(error);
                    console.error('[TTS] Background health check failed', error);
                });
            }
        }, 30000);
    }

    private async loadConfig() {
        try {
            // 1. Load baseline from CLI Setup (.env.local)
            if (process.env.VOICE_PROVIDER) {
                this.config.provider = process.env.VOICE_PROVIDER as 'local' | 'minimax';
            }
            if (process.env.VOICE_ID) {
                this.config.voiceId = process.env.VOICE_ID;
            }
            if (process.env.ENABLE_VOICE_ENGINE !== undefined) {
                this.config.enabled = process.env.ENABLE_VOICE_ENGINE === 'true';
            }

            // 2. Allow SQLite runtime overrides (Web UI/Telegram settings)
            const { sqliteService } = await import('./sqliteService');
            const savedConfig = sqliteService.getConfig('voice_settings');
            if (savedConfig && !this.backgroundStopped) {
                this.config = { ...this.config, ...savedConfig };
            }
        } catch (e) {
            console.warn('[TTS] Failed to load config', e);
        }
    }

    private async saveConfig() {
        try {
            const { sqliteService } = await import('./sqliteService');
            sqliteService.setConfig('voice_settings', this.config);
        } catch (e) {
            console.warn('[TTS] Failed to save config', e);
        }
    }

    public static getInstance(): TTSService {
        if (!TTSService.instance) {
            TTSService.instance = new TTSService();
        }
        return TTSService.instance;
    }

    /**
     * Clean text for speech (remove thoughts, logs, markdown)
     */
    public cleanForSpeech(text: string): string {
        if (!text) return '';

        let clean = text;

        // 1. Remove <thought> or <think> tags (XML style)
        clean = clean.replace(/<(?:thought|think)>[\s\S]*?<\/(?:thought|think)>/gi, '');

        // 2. Remove [BLOCK] style thoughts (System logs)
        // Matches [INTROSPECTION] ..., [THOUGHT] ..., etc.
        // Be careful not to match legitimate brackets in text
        clean = clean.replace(/^\[(INTROSPECTION|THOUGHT|NARRATIVE|DEBUG|WARNING|ERROR)\].*$/gm, '');

        // 3. Remove Markdown code blocks
        clean = clean.replace(/```[\s\S]*?```/g, ' Code block omitted. ');

        // 4. Remove excessive whitespace
        clean = clean.replace(/\s+/g, ' ').trim();

        return clean;
    }

    /**
     * Generate speech from text
     */
    public async speak(text: string, options?: { voiceId?: string }): Promise<string | null> {
        // Per-call voice override (e.g. a phone call's chosen voice); the global config voice is only the default.
        const voiceId = options?.voiceId || this.config.voiceId;
        if (!this.config.enabled) return null;

        const cleanText = this.cleanForSpeech(text);
        if (!cleanText || cleanText.length < 2) return null;

        console.log(`[TTS] 🗣️ Request: "${cleanText.substring(0, 30)}..." (Provider: ${this.config.provider})`);

        // --- MINIMAX CLOUD AUDIO ---
        if (this.config.provider === 'minimax') {
            try {
                const audioUrl = await minimaxService.generateSpeech(cleanText, voiceId);
                if (audioUrl) {
                    return audioUrl;
                }
                console.warn('[TTS] ⚠️ Minimax Audio Engine returned null. Falling back to Local Python Engine...');
            } catch (error) {
                console.warn('[TTS] ⚠️ Minimax Audio Engine failed. Falling back to Local Python Engine...', error);
            }
            // Temporarily set provider to 'local' for this run if minimax failed entirely? 
            // Better to just let it fallback gracefully below.
        }

        // --- LOCAL PYTHON ENGINE ---
        // Auto-wake if engine is sleeping
        if (!this.isEngineAwake) {
            console.log('[TTS] ⚡ Local engine sleeping - attempting to wake...');
            await this.wake();
            // Wait a bit for model to load
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        try {
            // Try Local Python Engine First
            const response = await axios.post(`${this.pythonEngineUrl}/speak`, {
                text: cleanText,
                language: 'es',
                voice_id: voiceId, // Pass configured voice
                auto_speak: this.config.autoSpeak // Pass autoSpeak mode for intelligent sleep/wake
            }, { timeout: 120000 }); // 120s timeout for TTS generation (Chatterbox model loading)

            if (response.data && response.data.success) {
                this.isEngineAwake = true;
                return response.data.url;
            }
        } catch (error: any) {
            console.warn('[TTS] ⚠️ Local Engine failed or sleeping:', error.message);
            this.isEngineAwake = false;

            // One more attempt after wake
            if (error.code === 'ECONNREFUSED' || error.response?.status === 500) {
                console.log('[TTS] 🔄 Retrying after wake...');
                await this.wake();
                await new Promise(resolve => setTimeout(resolve, 3000));

                try {
                    const retryResponse = await axios.post(`${this.pythonEngineUrl}/speak`, {
                        text: cleanText,
                        language: 'es',
                        voice_id: voiceId,
                        auto_speak: this.config.autoSpeak
                    }, { timeout: 120000 });

                    if (retryResponse.data && retryResponse.data.success) {
                        this.isEngineAwake = true;
                        return retryResponse.data.url;
                    }
                } catch (retryError) {
                    console.error('[TTS] ❌ Retry failed - voice engine unavailable');
                }
            }
        }

        // --- ELEVENLABS CLOUD FALLBACK ---
        // Last resort when Minimax and the local engine are both unavailable.
        // Uses ELEVENLABS_VOICE_ID (a premade, non-library voice: library voices
        // are paid-plan only). The provider-specific voiceId does not apply here.
        const elKey = process.env.ELEVENLABS_API_KEY;
        const elVoice = process.env.ELEVENLABS_VOICE_ID;
        if (elKey && elVoice) {
            try {
                const { elevenLabsService } = await import('./media/elevenLabsService');
                const outDir = path.resolve(process.cwd(), 'public/output/tts');
                fs.mkdirSync(outDir, { recursive: true });
                const outPath = path.join(outDir, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.mp3`);
                const spoken = await elevenLabsService.generateSpeech(cleanText, outPath, elVoice);
                if (spoken) {
                    const url = `/output/tts/${path.basename(spoken)}`;
                    console.log(`[TTS] ✅ ElevenLabs fallback served: ${url}`);
                    return url;
                }
            } catch (error) {
                console.warn('[TTS] ⚠️ ElevenLabs fallback failed:', error);
            }
        }

        return null; // Fallback completely failed
    }

    public async getVoices(): Promise<{ default_models: string[], cloned_voices: string[] }> {
        try {
            const res = await axios.get(`${this.pythonEngineUrl}/voices`);
            return res.data;
        } catch (e) {
            console.warn('[TTS] Failed to list voices');
            return { default_models: [], cloned_voices: [] };
        }
    }

    public async cloneVoice(file: any, name: string): Promise<any> {
        try {
            const FormDataModule = await import('form-data');
            const FormDataClass = (FormDataModule.default || FormDataModule) as any;
            const form = new FormDataClass();
            form.append('file', fs.createReadStream(file.path));
            form.append('name', name);

            const res = await axios.post(`${this.pythonEngineUrl}/voices/clone`, form, {
                headers: form.getHeaders()
            });
            return res.data;
        } catch (e) {
            console.error('[TTS] Clone failed', e);
            throw e;
        }
    }

    public async sleep() {
        try {
            await axios.post(`${this.pythonEngineUrl}/sleep`);
            this.isEngineAwake = false;
            console.log('[TTS] 💤 Engine put to sleep (VRAM freed)');
        } catch (e) {
            console.warn('[TTS] Failed to sleep engine');
        }
    }

    public async wake() {
        try {
            await axios.post(`${this.pythonEngineUrl}/wake`);
            this.isEngineAwake = true;
            console.log('[TTS] ☀️ Engine woke up');
        } catch (e) {
            console.warn('[TTS] Failed to wake engine');
        }
    }

    /** Initial config load and health check settled; not an availability guarantee. */
    public ready(): Promise<void> {
        return this.backgroundReady;
    }

    /** Stops constructor-owned config initialization/health polling only.
     * Owners must separately await speech, wake, sleep and config writes.
     * Terminal: no implicit restart and no global application shutdown.
     */
    public stopBackgroundWork(): Promise<void> {
        if (this.backgroundStop) return this.backgroundStop;
        this.backgroundStopped = true;
        if (this.healthTimer !== null) clearInterval(this.healthTimer);
        this.healthTimer = null;
        for (const controller of this.healthControllers) controller.abort();
        // Admission is closed synchronously, so this is the complete owned set.
        this.backgroundStop = Promise.allSettled([
            this.initialConfig,
            this.initialHealth,
            ...this.healthRequests
        ]).then(results => {
            const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
            // Also retain rejected interval work that settled before stop.
            for (const failure of this.healthFailures) if (!failures.includes(failure)) failures.push(failure);
            if (failures.length) throw new AggregateError(failures, 'TTS background drainage failed');
        });
        return this.backgroundStop;
    }

    private checkEngineHealth(): Promise<void> {
        if (this.backgroundStopped) return Promise.resolve();
        const controller = new AbortController();
        this.healthControllers.add(controller);
        const request: Promise<void> = axios.get(`${this.pythonEngineUrl}/`, { signal: controller.signal })
            .then(() => {
                if (!this.backgroundStopped) this.isEngineAwake = true;
            }, () => {
                if (!this.backgroundStopped) this.isEngineAwake = false;
            })
            .finally(() => {
                this.healthControllers.delete(controller);
                this.healthRequests.delete(request);
            });
        this.healthRequests.add(request);
        return request;
    }

    public getHealth() {
        return {
            status: this.isEngineAwake ? 'ONLINE' : 'OFFLINE/SLEEPING',
            engineUrl: this.pythonEngineUrl,
            config: this.config
        };
    }

    /**
     * True when the local Python voice engine (voice_engine/, Chatterbox TTS)
     * answered its last health check. Used to offer honest local voice
     * cloning instead of pretending or silently falling back.
     */
    public isLocalEngineAvailable(): boolean {
        return this.isEngineAwake;
    }

    public updateConfig(newConfig: Partial<VoiceConfig>) {
        this.config = { ...this.config, ...newConfig };
        this.saveConfig();
    }

    public getConfig() {
        return this.config;
    }
}

export const ttsService = TTSService.getInstance();
