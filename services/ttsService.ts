
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { resourceArbiter } from './resourceArbiter';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

export interface VoiceConfig {
    enabled: boolean;
    autoSpeak: boolean;
    voiceId?: string;
    volume: number;
}

export class TTSService {
    private static instance: TTSService;
    private pythonEngineUrl = 'http://localhost:8100';
    private isEngineAwake = false;

    // Config default
    private config: VoiceConfig = {
        enabled: true,
        autoSpeak: false,
        volume: 1.0
    };

    private constructor() {
        console.log('[TTS] Service Initialized. Connecting to Voice Engine...');
        this.loadConfig(); // Load from DB
        this.checkEngineHealth();

        // Periodic Health Check
        setInterval(() => this.checkEngineHealth(), 30000);
    }

    private async loadConfig() {
        try {
            const { sqliteService } = await import('./sqliteService');
            const savedConfig = sqliteService.getConfig('voice_settings');
            if (savedConfig) {
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

        // 1. Remove <thought> tags (XML style)
        clean = clean.replace(/<thought>[\s\S]*?<\/thought>/gi, '');

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

        console.log(`[TTS] 🗣️ Request: "${cleanText.substring(0, 30)}..." (Voice: ${this.config.voiceId || 'Default'})`);

        // Auto-wake if engine is sleeping
        if (!this.isEngineAwake) {
            console.log('[TTS] ⚡ Engine sleeping - attempting to wake...');
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

        return null; // Fallback currently not implemented
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

    private async checkEngineHealth() {
        try {
            await axios.get(`${this.pythonEngineUrl}/`);
            this.isEngineAwake = true;
        } catch (e) {
            this.isEngineAwake = false;
        }
    }

    public getHealth() {
        return {
            status: this.isEngineAwake ? 'ONLINE' : 'OFFLINE/SLEEPING',
            config: this.config
        };
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
