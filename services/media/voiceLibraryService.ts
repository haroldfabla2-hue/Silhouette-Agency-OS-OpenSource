/**
 * Voice Library Service
 * Manages curated voice samples and user-cloned voices
 * Integrates with HuggingFace XTTS-v2 samples and local storage
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { sqliteService } from '../sqliteService';

// Voice categories
export type VoiceCategory = 'library' | 'cloned' | 'custom';
export type VoiceGender = 'male' | 'female' | 'neutral';
export type VoiceStyle = 'professional' | 'casual' | 'narrative' | 'expressive' | 'neutral';

export interface Voice {
    id: string;
    name: string;
    description?: string;
    category: VoiceCategory;
    language: string;
    gender?: VoiceGender;
    style?: VoiceStyle;
    samplePath: string;
    thumbnailUrl?: string;
    isDefault: boolean;
    isDownloaded: boolean;
    duration?: number;
    createdAt: Date;
    metadata?: Record<string, any>;
}

// Curated library voices from HuggingFace XTTS-v2
const CURATED_VOICES: Omit<Voice, 'samplePath' | 'isDownloaded' | 'createdAt'>[] = [
    {
        id: 'xtts_en_sample',
        name: 'Alex',
        description: 'Clear English voice with neutral accent',
        category: 'library',
        language: 'en',
        gender: 'neutral',
        style: 'professional',
        isDefault: true,
        thumbnailUrl: '🇺🇸'
    },
    {
        id: 'xtts_es_sample',
        name: 'María',
        description: 'Spanish voice with natural flow',
        category: 'library',
        language: 'es',
        gender: 'female',
        style: 'casual',
        isDefault: false,
        thumbnailUrl: '🇪🇸'
    },
    {
        id: 'xtts_fr_sample',
        name: 'Pierre',
        description: 'French voice with elegant tone',
        category: 'library',
        language: 'fr',
        gender: 'male',
        style: 'narrative',
        isDefault: false,
        thumbnailUrl: '🇫🇷'
    },
    {
        id: 'xtts_de_sample',
        name: 'Hans',
        description: 'German voice with professional clarity',
        category: 'library',
        language: 'de',
        gender: 'male',
        style: 'professional',
        isDefault: false,
        thumbnailUrl: '🇩🇪'
    },
    {
        id: 'xtts_it_sample',
        name: 'Giulia',
        description: 'Italian voice with expressive warmth',
        category: 'library',
        language: 'it',
        gender: 'female',
        style: 'expressive',
        isDefault: false,
        thumbnailUrl: '🇮🇹'
    },
    {
        id: 'xtts_pt_sample',
        name: 'João',
        description: 'Portuguese voice with friendly tone',
        category: 'library',
        language: 'pt',
        gender: 'male',
        style: 'casual',
        isDefault: false,
        thumbnailUrl: '🇵🇹'
    },
    {
        id: 'xtts_ja_sample',
        name: 'Yuki',
        description: 'Japanese voice with clear pronunciation',
        category: 'library',
        language: 'ja',
        gender: 'female',
        style: 'professional',
        isDefault: false,
        thumbnailUrl: '🇯🇵'
    },
    {
        id: 'xtts_zh_sample',
        name: 'Wei',
        description: 'Chinese Mandarin voice',
        category: 'library',
        language: 'zh-cn',
        gender: 'female',
        style: 'neutral',
        isDefault: false,
        thumbnailUrl: '🇨🇳'
    },
    {
        id: 'xtts_ru_sample',
        name: 'Alexei',
        description: 'Russian voice with deep resonance',
        category: 'library',
        language: 'ru',
        gender: 'male',
        style: 'narrative',
        isDefault: false,
        thumbnailUrl: '🇷🇺'
    },
    {
        id: 'xtts_ar_sample',
        name: 'Fatima',
        description: 'Arabic voice with elegant flow',
        category: 'library',
        language: 'ar',
        gender: 'female',
        style: 'professional',
        isDefault: false,
        thumbnailUrl: '🇸🇦'
    }
];

// HuggingFace XTTS-v2 sample URLs
const HUGGINGFACE_BASE = 'https://huggingface.co/coqui/XTTS-v2/resolve/main/samples';
const LANGUAGE_TO_FILE: Record<string, string> = {
    'en': 'en_sample.wav',
    'es': 'es_sample.wav',
    'fr': 'fr_sample.wav',
    'de': 'de_sample.wav',
    'it': 'it_sample.wav',
    'pt': 'pt_sample.wav',
    'ja': 'ja_sample.wav',
    'zh-cn': 'zh-cn_sample.wav',
    'ru': 'ru_sample.wav',
    'ar': 'ar_sample.wav'
};

class VoiceLibraryService {
    private static instance: VoiceLibraryService;
    private voicesDir: string;
    private libraryDir: string;
    private clonedDir: string;
    private voices: Map<string, Voice> = new Map();
    private initialized = false;

    private constructor() {
        const baseDir = path.join(process.cwd(), 'uploads', 'voice');
        this.voicesDir = path.join(baseDir, 'voices');
        this.libraryDir = path.join(baseDir, 'library');
        this.clonedDir = path.join(baseDir, 'cloned');

        // Ensure directories exist
        [this.voicesDir, this.libraryDir, this.clonedDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    public static getInstance(): VoiceLibraryService {
        if (!VoiceLibraryService.instance) {
            VoiceLibraryService.instance = new VoiceLibraryService();
        }
        return VoiceLibraryService.instance;
    }

    /**
     * Initialize the voice library
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[VOICE_LIBRARY] Initializing...');

        // Load curated voices
        for (const voice of CURATED_VOICES) {
            const samplePath = path.join(this.libraryDir, `${voice.id}.wav`);
            const isDownloaded = fs.existsSync(samplePath);

            this.voices.set(voice.id, {
                ...voice,
                samplePath,
                isDownloaded,
                createdAt: new Date()
            });
        }

        // Load user-cloned voices from disk
        await this.loadClonedVoices();

        // Load any saved voices from SQLite
        await this.loadFromDatabase();

        this.initialized = true;
        console.log(`[VOICE_LIBRARY] ✅ Loaded ${this.voices.size} voices (${this.getDownloadedCount()} downloaded)`);
    }

    /**
     * Get all voices in the library
     */
    public async getAllVoices(): Promise<Voice[]> {
        await this.initialize();
        return Array.from(this.voices.values());
    }

    /**
     * Get voices by category
     */
    public async getVoicesByCategory(category: VoiceCategory): Promise<Voice[]> {
        const all = await this.getAllVoices();
        return all.filter(v => v.category === category);
    }

    /**
     * Get voices by language
     */
    public async getVoicesByLanguage(language: string): Promise<Voice[]> {
        const all = await this.getAllVoices();
        return all.filter(v => v.language === language || v.language.startsWith(language));
    }

    /**
     * Get a specific voice by ID
     */
    public async getVoice(id: string): Promise<Voice | undefined> {
        await this.initialize();
        return this.voices.get(id);
    }

    /**
     * Get the default voice
     */
    public async getDefaultVoice(): Promise<Voice | undefined> {
        const all = await this.getAllVoices();
        return all.find(v => v.isDefault && v.isDownloaded) || all.find(v => v.isDownloaded);
    }

    /**
     * Download a library voice from HuggingFace
     */
    public async downloadVoice(voiceId: string): Promise<{ success: boolean; error?: string }> {
        await this.initialize();

        const voice = this.voices.get(voiceId);
        if (!voice) {
            return { success: false, error: 'Voice not found' };
        }

        if (voice.isDownloaded) {
            return { success: true };
        }

        const langCode = voice.language.split('-')[0];
        const fileName = LANGUAGE_TO_FILE[voice.language] || LANGUAGE_TO_FILE[langCode];

        if (!fileName) {
            return { success: false, error: `No sample available for language: ${voice.language}` };
        }

        const url = `${HUGGINGFACE_BASE}/${fileName}`;
        console.log(`[VOICE_LIBRARY] Downloading ${voice.name} from ${url}...`);

        try {
            await this.downloadFile(url, voice.samplePath);
            voice.isDownloaded = true;
            this.voices.set(voiceId, voice);

            // Save to database
            await this.saveToDatabase(voice);

            console.log(`[VOICE_LIBRARY] ✅ Downloaded ${voice.name}`);
            return { success: true };
        } catch (error: any) {
            console.error(`[VOICE_LIBRARY] ❌ Failed to download ${voice.name}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Download all library voices
     */
    public async downloadAllVoices(onProgress?: (current: number, total: number, name: string) => void): Promise<void> {
        const libraryVoices = await this.getVoicesByCategory('library');
        const toDownload = libraryVoices.filter(v => !v.isDownloaded);

        console.log(`[VOICE_LIBRARY] Downloading ${toDownload.length} voices...`);

        for (let i = 0; i < toDownload.length; i++) {
            const voice = toDownload[i];
            onProgress?.(i + 1, toDownload.length, voice.name);
            await this.downloadVoice(voice.id);
        }

        console.log(`[VOICE_LIBRARY] ✅ All voices downloaded`);
    }

    /**
     * Add a cloned voice to the library
     */
    public async addClonedVoice(
        name: string,
        samplePath: string,
        language: string,
        metadata?: Record<string, any>
    ): Promise<Voice> {
        const id = `cloned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Copy file to cloned directory
        const targetPath = path.join(this.clonedDir, `${id}.wav`);
        fs.copyFileSync(samplePath, targetPath);

        const voice: Voice = {
            id,
            name,
            description: `Custom cloned voice - ${name}`,
            category: 'cloned',
            language,
            samplePath: targetPath,
            isDefault: false,
            isDownloaded: true,
            createdAt: new Date(),
            metadata
        };

        this.voices.set(id, voice);
        await this.saveToDatabase(voice);

        console.log(`[VOICE_LIBRARY] ✅ Added cloned voice: ${name}`);
        return voice;
    }

    /**
     * Delete a user voice (only cloned/custom voices can be deleted)
     */
    public async deleteVoice(voiceId: string): Promise<{ success: boolean; error?: string }> {
        const voice = this.voices.get(voiceId);

        if (!voice) {
            return { success: false, error: 'Voice not found' };
        }

        if (voice.category === 'library') {
            return { success: false, error: 'Cannot delete library voices' };
        }

        // Delete file
        if (fs.existsSync(voice.samplePath)) {
            fs.unlinkSync(voice.samplePath);
        }

        // Remove from memory
        this.voices.delete(voiceId);

        // Remove from database
        await this.deleteFromDatabase(voiceId);

        console.log(`[VOICE_LIBRARY] 🗑️ Deleted voice: ${voice.name}`);
        return { success: true };
    }

    /**
     * Set a voice as default
     */
    public async setDefaultVoice(voiceId: string): Promise<void> {
        for (const [id, voice] of this.voices) {
            voice.isDefault = id === voiceId;
            await this.saveToDatabase(voice);
        }
    }

    /**
     * Get the sample path for a voice
     */
    public async getVoiceSamplePath(voiceId: string): Promise<string | null> {
        const voice = await this.getVoice(voiceId);
        if (!voice || !voice.isDownloaded) return null;
        return voice.samplePath;
    }

    // Private helpers

    private getDownloadedCount(): number {
        return Array.from(this.voices.values()).filter(v => v.isDownloaded).length;
    }

    private async downloadFile(url: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);

            const request = (urlToFetch: string) => {
                https.get(urlToFetch, (response) => {
                    // Handle redirects (301, 302, 307, 308)
                    if ([301, 302, 307, 308].includes(response.statusCode || 0)) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            console.log(`[VOICE_LIBRARY] Following redirect to: ${redirectUrl.substring(0, 60)}...`);
                            request(redirectUrl);
                            return;
                        }
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}`));
                        return;
                    }

                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', (err) => {
                    fs.unlink(destPath, () => { }); // Delete partial file
                    reject(err);
                });
            };

            request(url);
        });
    }

    private async loadClonedVoices(): Promise<void> {
        if (!fs.existsSync(this.clonedDir)) return;

        const files = fs.readdirSync(this.clonedDir).filter(f => f.endsWith('.wav'));

        for (const file of files) {
            const id = file.replace('.wav', '');
            if (this.voices.has(id)) continue;

            const samplePath = path.join(this.clonedDir, file);
            const stats = fs.statSync(samplePath);

            this.voices.set(id, {
                id,
                name: file.replace('.wav', '').replace(/_/g, ' '),
                category: 'cloned',
                language: 'es',
                samplePath,
                isDefault: false,
                isDownloaded: true,
                createdAt: stats.birthtime
            });
        }
    }

    private async loadFromDatabase(): Promise<void> {
        try {
            const savedVoices = sqliteService.getConfig('voice_library');
            if (savedVoices && Array.isArray(savedVoices)) {
                for (const saved of savedVoices) {
                    const existing = this.voices.get(saved.id);
                    if (existing) {
                        // Merge saved data
                        this.voices.set(saved.id, { ...existing, ...saved, createdAt: new Date(saved.createdAt) });
                    }
                }
            }
        } catch (e) {
            console.warn('[VOICE_LIBRARY] Failed to load from database:', e);
        }
    }

    private async saveToDatabase(voice: Voice): Promise<void> {
        try {
            const all = Array.from(this.voices.values()).map(v => ({
                ...v,
                createdAt: v.createdAt.toISOString()
            }));
            sqliteService.setConfig('voice_library', all);
        } catch (e) {
            console.warn('[VOICE_LIBRARY] Failed to save to database:', e);
        }
    }

    private async deleteFromDatabase(voiceId: string): Promise<void> {
        await this.saveToDatabase({ id: voiceId } as Voice); // Will save all remaining voices
    }
}

export const voiceLibraryService = VoiceLibraryService.getInstance();
