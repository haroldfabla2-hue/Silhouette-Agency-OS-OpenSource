
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { resourceArbiter } from './resourceArbiter';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';
import { minimaxService } from './minimaxService'; // Inject Minimax TTS

export interface VoiceConfig {
    enabled: boolean;
    autoSpeak: boolean;
    voiceId?: string;
    volume: number;
    provider: 'local' | 'minimax'; // NEW PROXY
    localEngineEnabled: boolean;
}

export class TTSService {
    private static instance: TTSService;
    private pythonEngineUrl = 'http://localhost:8100';
    private isEngineAwake = false;
    private healthCheckTimer: NodeJS.Timeout | null = null;

    // Config default
    private config: VoiceConfig = {
        enabled: process.env.VOICE_ENABLED !== 'false',
        autoSpeak: false,
        volume: 1.0,
        provider: 'minimax', // Set Minimax as default provider to save VRAM
        localEngineEnabled: process.env.ENABLE_VOICE_ENGINE === 'true'
    };

    private constructor() {
        console.log('[TTS] Service Initialized.');
        this.loadConfig(); // Load from DB and sync health monitoring
    }

    private async loadConfig() {
        try {
            const normalizeVoiceConfig = () => {
                const originalVoiceId = this.config.voiceId;
                if (this.config.provider === 'minimax') {
                    this.config.voiceId = minimaxService.normalizeVoiceId(this.config.voiceId);
                }
                return originalVoiceId !== this.config.voiceId;
            };

            // 1. Load baseline from CLI Setup (.env.local)
            if (process.env.VOICE_ENABLED !== undefined) {
                this.config.enabled = process.env.VOICE_ENABLED === 'true';
            }
            if (process.env.VOICE_PROVIDER) {
                this.config.provider = process.env.VOICE_PROVIDER as 'local' | 'minimax';
            }
            if (process.env.VOICE_ID) {
                this.config.voiceId = process.env.VOICE_ID;
            }
            if (process.env.ENABLE_VOICE_ENGINE !== undefined) {
                this.config.localEngineEnabled = process.env.ENABLE_VOICE_ENGINE === 'true';
            }

            // 2. Allow SQLite runtime overrides (Web UI/Telegram settings)
            const { sqliteService } = await import('./sqliteService');
            const savedConfig = sqliteService.getConfig('voice_settings');
            if (savedConfig) {
                this.config = { ...this.config, ...savedConfig };
            }

            const normalized = normalizeVoiceConfig();
            this.syncHealthMonitoring();
            if (normalized) {
                await this.saveConfig();
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

    private shouldUseLocalEngine(): boolean {
        return this.config.provider === 'local' && this.config.localEngineEnabled;
    }

    private syncHealthMonitoring(): void {
        if (this.shouldUseLocalEngine()) {
            if (!this.healthCheckTimer) {
                console.log('[TTS] Local voice engine enabled. Starting health checks.');
                this.checkEngineHealth();
                this.healthCheckTimer = setInterval(() => this.checkEngineHealth(), 30000);
            }
            return;
        }

        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        this.isEngineAwake = false;
        console.log(`[TTS] Using ${this.config.provider} voice provider without local engine.`);
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
    public async speak(text: string): Promise<string | null> {
        if (!this.config.enabled) return null;

        const cleanText = this.cleanForSpeech(text);
        if (!cleanText || cleanText.length < 2) return null;

        console.log(`[TTS] 🗣️ Request: "${cleanText.substring(0, 30)}..." (Provider: ${this.config.provider})`);

        // --- MINIMAX CLOUD AUDIO ---
        if (this.config.provider === 'minimax') {
            try {
                const audioUrl = await minimaxService.generateSpeech(cleanText, this.config.voiceId);
                if (audioUrl) {
                    return audioUrl;
                }
                console.warn('[TTS] ⚠️ Minimax Audio Engine returned null.');
            } catch (error) {
                console.warn('[TTS] ⚠️ Minimax Audio Engine failed.', error);
            }
            return null;
        }

        // --- LOCAL PYTHON ENGINE ---
        if (!this.shouldUseLocalEngine()) {
            console.warn('[TTS] Local voice engine requested but disabled.');
            return null;
        }

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
                voice_id: this.config.voiceId, // Pass configured voice
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
                        voice_id: this.config.voiceId,
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

        return null; // Fallback completely failed
    }

    public async getVoices(): Promise<{ default_models: string[], cloned_voices: string[] }> {
        if (this.config.provider === 'minimax') {
            try {
                const voices = await minimaxService.listVoices();
                return {
                    default_models: voices.map((voice) => voice.id),
                    cloned_voices: []
                };
            } catch (error) {
                console.warn('[TTS] Failed to list MiniMax voices', error);
                return {
                    default_models: [
                        minimaxService.getDefaultVoiceId(),
                        'English_CalmWoman',
                        'English_magnetic_voiced_man'
                    ],
                    cloned_voices: []
                };
            }
        }

        if (!this.shouldUseLocalEngine()) {
            return {
                default_models: [minimaxService.getDefaultVoiceId()],
                cloned_voices: []
            };
        }

        try {
            const res = await axios.get(`${this.pythonEngineUrl}/voices`);
            return res.data;
        } catch (e) {
            console.warn('[TTS] Failed to list voices');
            return { default_models: [], cloned_voices: [] };
        }
    }

    public async cloneVoice(file: any, name: string): Promise<any> {
        if (!this.shouldUseLocalEngine()) {
            throw new Error('Voice cloning requires the local voice engine.');
        }

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
        if (!this.shouldUseLocalEngine()) {
            console.log('[TTS] Sleep skipped: local voice engine disabled.');
            return;
        }

        try {
            await axios.post(`${this.pythonEngineUrl}/sleep`);
            this.isEngineAwake = false;
            console.log('[TTS] 💤 Engine put to sleep (VRAM freed)');
        } catch (e) {
            console.warn('[TTS] Failed to sleep engine');
        }
    }

    public async wake() {
        if (!this.shouldUseLocalEngine()) {
            console.log('[TTS] Wake skipped: local voice engine disabled.');
            return;
        }

        try {
            await axios.post(`${this.pythonEngineUrl}/wake`);
            this.isEngineAwake = true;
            console.log('[TTS] ☀️ Engine woke up');
        } catch (e) {
            console.warn('[TTS] Failed to wake engine');
        }
    }

    private async checkEngineHealth() {
        if (!this.shouldUseLocalEngine()) {
            this.isEngineAwake = false;
            return;
        }

        try {
            await axios.get(`${this.pythonEngineUrl}/`);
            this.isEngineAwake = true;
        } catch (e) {
            this.isEngineAwake = false;
        }
    }

    public getHealth() {
        return {
            status: this.config.provider === 'minimax'
                ? 'CLOUD'
                : (this.isEngineAwake ? 'ONLINE' : 'OFFLINE/SLEEPING'),
            config: this.config
        };
    }

    public updateConfig(newConfig: Partial<VoiceConfig>) {
        this.config = { ...this.config, ...newConfig };
        if (this.config.provider === 'minimax') {
            this.config.voiceId = minimaxService.normalizeVoiceId(this.config.voiceId);
        }
        this.syncHealthMonitoring();
        this.saveConfig();
    }

    public getConfig() {
        return this.config;
    }
}

export const ttsService = TTSService.getInstance();
