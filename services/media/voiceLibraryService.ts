import { ResourceScope } from '../../server/runtime/resourceScope';
import { downloadOwnedHttpsFile,type DownloadReceipt } from '../../server/runtime/ownedHttpsDownload';
/**
 * Voice Library Service
 * Manages curated voice samples and user-cloned voices
 * Integrates with HuggingFace XTTS-v2 samples and local storage
 */

import fs from 'fs';
import path from 'path';
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

interface VoiceMutationReceipt {
    id:number;operation:string;voiceId:string;path?:string;
    state:'PENDING'|'EFFECT_UNKNOWN'|'FILE_APPLIED_METADATA_PENDING'|'APPLIED_READBACK';error?:unknown;
}
class VoiceLibraryService {
    private readonly operations=new ResourceScope('voice-library');
    private readyTask?:Promise<void>;
    private readonly downloads=new Map<string,Promise<{success:boolean;error?:string}>>();
    private readonly downloadReceipts=new Map<string,DownloadReceipt>();
    private mutationTail:Promise<unknown>=Promise.resolve();
    private metadataUncertain=false;
    private readonly mutationReceipts:VoiceMutationReceipt[]=[];
    private beginMutation(operation:string,voiceId:string,filePath?:string):VoiceMutationReceipt{
        const receipt:VoiceMutationReceipt={id:this.mutationReceipts.length+1,operation,voiceId,path:filePath,state:'PENDING'};
        this.mutationReceipts.push(receipt);return receipt;
    }
    private readonly pendingMutations:Array<{operation:string;phase:string;error:unknown}>=[];
    public getLifecycleStatus(){return {readiness:this.initialized?'READY_LOCAL':'NOT_READY',metadataUncertain:this.metadataUncertain,
        mutations:this.mutationReceipts.map(r=>({...r})),downloads:[...this.downloadReceipts].map(([voiceId,r])=>({voiceId,...r})),pendingMutations:this.pendingMutations.map(r=>({...r})),
        failures:this.operations.getFailures(),diagnostics:this.operations.getDiagnostics(),pendingDurable:false,poolRelease:'UNVERIFIED'};}
    public shutdown(){return this.operations.close();}
    private mutate<T>(name:string,operation:()=>Promise<T>):Promise<T>{
        return this.operations.run('voice-mutation:'+name,()=>{
            const actual=this.mutationTail.then(async()=>{
                if(this.metadataUncertain)throw new Error('Voice metadata/effect state is uncertain; reconciliation required, replay blocked');
                return operation();
            });
            // An earlier failure is retained by its own operation/receipt. The
            // queue remains usable only when the uncertainty fence permits it.
            this.mutationTail=actual.catch(()=>{});return actual;
        });
    }
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
        this.operations.own({name:'voice-library-application',close:()=>({state:'UNVERIFIED',detail:'Application promises/observed HTTPS/file closes only; shared global Agent/SQLite owner, pending crash durability and unresolved metadata/partials are separate obligations'})});


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
        this.operations.assertWorkAccepted();
        if(this.readyTask)return this.readyTask;
        this.readyTask=this.operations.run('voice-library-readiness',async()=>{
        // Ensure directories exist
        [this.voicesDir, this.libraryDir, this.clonedDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });


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
        if(this.metadataUncertain)throw new Error('Voice library metadata readiness failed; manual reconciliation required');

        this.initialized = true;
        console.log(`[VOICE_LIBRARY] ✅ Loaded ${this.voices.size} voices (${this.getDownloadedCount()} downloaded)`);
        });
        void this.readyTask.catch(error=>this.operations.recordFailure('voice-library-first-readiness',error));
        return this.readyTask;
    }

    /**
     * Get all voices in the library
     */
    public async getAllVoices(): Promise<Voice[]> {
        return this.operations.run('getAllVoices',async()=>{

        await this.initialize();
        return Array.from(this.voices.values());
    
        });
}

    /**
     * Get voices by category
     */
    public async getVoicesByCategory(category: VoiceCategory): Promise<Voice[]> {
        return this.operations.run('getVoicesByCategory',async()=>{

        const all = await this.getAllVoices();
        return all.filter(v => v.category === category);
    
        });
}

    /**
     * Get voices by language
     */
    public async getVoicesByLanguage(language: string): Promise<Voice[]> {
        return this.operations.run('getVoicesByLanguage',async()=>{

        const all = await this.getAllVoices();
        return all.filter(v => v.language === language || v.language.startsWith(language));
    
        });
}

    /**
     * Get a specific voice by ID
     */
    public async getVoice(id: string): Promise<Voice | undefined> {
        return this.operations.run('getVoice',async()=>{

        await this.initialize();
        return this.voices.get(id);
    
        });
}

    /**
     * Get the default voice
     */
    public async getDefaultVoice(): Promise<Voice | undefined> {
        return this.operations.run('getDefaultVoice',async()=>{

        const all = await this.getAllVoices();
        return all.find(v => v.isDefault && v.isDownloaded) || all.find(v => v.isDownloaded);
    
        });
}

    /**
     * Download a library voice from HuggingFace
     */
    public async downloadVoice(voiceId: string): Promise<{ success: boolean; error?: string }> {
        this.operations.assertWorkAccepted();
        const existing=this.downloads.get(voiceId);if(existing)return existing;
        const actual=this.mutate('downloadVoice:'+voiceId,async()=>{

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
            await this.downloadFile(url, voice.samplePath,voiceId);
            voice.isDownloaded = true;
            this.voices.set(voiceId, voice);

            // Save to database
            await this.saveToDatabase(voice);
            const receipt=this.downloadReceipts.get(voiceId)!;
            if(this.metadataUncertain){receipt.error=new Error('Voice file applied, metadata uncertain; no file replay');return {success:false,error:'File applied; metadata reconciliation required'};}
            receipt.state='METADATA_READBACK';

            console.log(`[VOICE_LIBRARY] ✅ Downloaded ${voice.name}`);
            return { success: true };
        } catch (error: any) {
            console.error(`[VOICE_LIBRARY] ❌ Failed to download ${voice.name}:`, error.message);
            const receipt=this.downloadReceipts.get(voiceId);
            if(receipt?.state==='COMMIT_UNKNOWN'){this.metadataUncertain=true;this.pendingMutations.push({operation:'downloadVoice:'+voiceId,phase:'RENAME_OUTCOME_UNKNOWN_NO_REPLAY',error});return {success:false,error:'Rename outcome unknown; reconciliation required, replay blocked'};}
            if(receipt?.fileApplied){receipt.error=error;return {success:false,error:'File applied; metadata uncertain, replay blocked: '+error.message};}
            return { success: false, error: error.message };
        }
    
        });
        this.downloads.set(voiceId,actual);return actual;
}

    /**
     * Download all library voices
     */
    public async downloadAllVoices(onProgress?: (current: number, total: number, name: string) => void): Promise<void> {
        return this.operations.run('downloadAllVoices',async()=>{

        const libraryVoices = await this.getVoicesByCategory('library');
        if(this.metadataUncertain)throw new Error('Voice batch blocked: applied metadata state requires reconciliation');
        const toDownload = libraryVoices.filter(v => !v.isDownloaded);

        console.log(`[VOICE_LIBRARY] Downloading ${toDownload.length} voices...`);
        const failures:Array<{voiceId:string;error?:string}>=[];

        for (let i = 0; i < toDownload.length; i++) {
            const voice = toDownload[i];
            onProgress?.(i + 1, toDownload.length, voice.name);
            const result=await this.downloadVoice(voice.id);
            if(!result.success)failures.push({voiceId:voice.id,error:result.error});
        }
        if(failures.length){
            const error=new Error('Voice download batch incomplete: '+failures.map(f=>f.voiceId+': '+f.error).join('; '));
            this.operations.recordFailure('voice-download-batch-incomplete',error);throw error;
        }
        console.log(`[VOICE_LIBRARY] ✅ All voices downloaded`);
    
        });
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
        return this.mutate('addClonedVoice',async()=>{
        await this.initialize();
        let mutation:VoiceMutationReceipt|undefined;
        try{

        const id = `cloned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Copy file to cloned directory
        const targetPath = path.join(this.clonedDir, `${id}.wav`);
        mutation=this.beginMutation('copy-cloned-voice',id,targetPath);mutation.state='EFFECT_UNKNOWN';
        fs.copyFileSync(samplePath, targetPath);
        mutation.state='FILE_APPLIED_METADATA_PENDING';

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
        mutation.state='APPLIED_READBACK';

        console.log(`[VOICE_LIBRARY] ✅ Added cloned voice: ${name}`);
        return voice;
    
        }catch(error){
            if(mutation){mutation.error=error;if(mutation.state==='PENDING')mutation.state='EFFECT_UNKNOWN';}
            this.metadataUncertain=true;this.operations.recordFailure('voice-addClonedVoice-uncertain',error);
            this.pendingMutations.push({operation:'addClonedVoice',phase:'POSSIBLY_APPLIED_NO_REPLAY',error});throw new Error('Voice mutation may have applied; reconciliation required, replay blocked',{cause:error});
        }
        });
}

    /**
     * Delete a user voice (only cloned/custom voices can be deleted)
     */
    public async deleteVoice(voiceId: string): Promise<{ success: boolean; error?: string }> {
        return this.mutate('deleteVoice',async()=>{
        await this.initialize();
        let mutation:VoiceMutationReceipt|undefined;
        try{

        const voice = this.voices.get(voiceId);

        if (!voice) {
            return { success: false, error: 'Voice not found' };
        }

        if (voice.category === 'library') {
            return { success: false, error: 'Cannot delete library voices' };
        }

        mutation=this.beginMutation('delete-voice',voiceId,voice.samplePath);mutation.state='EFFECT_UNKNOWN';
        // Delete file
        if (fs.existsSync(voice.samplePath)) {
            fs.unlinkSync(voice.samplePath);
        }

        // Remove from memory
        this.voices.delete(voiceId);mutation.state='FILE_APPLIED_METADATA_PENDING';

        // Remove from database
        await this.deleteFromDatabase(voiceId);
        mutation.state='APPLIED_READBACK';

        console.log(`[VOICE_LIBRARY] 🗑️ Deleted voice: ${voice.name}`);
        return { success: true };
    
        }catch(error){
            if(mutation){mutation.error=error;if(mutation.state==='PENDING')mutation.state='EFFECT_UNKNOWN';}
            this.metadataUncertain=true;this.operations.recordFailure('voice-deleteVoice-uncertain',error);
            this.pendingMutations.push({operation:'deleteVoice',phase:'POSSIBLY_APPLIED_NO_REPLAY',error});throw new Error('Voice mutation may have applied; reconciliation required, replay blocked',{cause:error});
        }
        });
}

    /**
     * Set a voice as default
     */
    public async setDefaultVoice(voiceId: string): Promise<void> {
        return this.mutate('setDefaultVoice',async()=>{
        await this.initialize();
        let mutation:VoiceMutationReceipt|undefined;
        try{

        mutation=this.beginMutation('set-default',voiceId);mutation.state='EFFECT_UNKNOWN';
        for (const [id, voice] of this.voices) {
            voice.isDefault = id === voiceId;
            await this.saveToDatabase(voice);
        }
        mutation.state='APPLIED_READBACK';
    
        }catch(error){
            if(mutation){mutation.error=error;if(mutation.state==='PENDING')mutation.state='EFFECT_UNKNOWN';}
            this.metadataUncertain=true;this.operations.recordFailure('voice-setDefaultVoice-uncertain',error);
            this.pendingMutations.push({operation:'setDefaultVoice',phase:'POSSIBLY_APPLIED_NO_REPLAY',error});throw new Error('Voice mutation may have applied; reconciliation required, replay blocked',{cause:error});
        }
        });
}

    /**
     * Get the sample path for a voice
     */
    public async getVoiceSamplePath(voiceId: string): Promise<string | null> {
        return this.operations.run('getVoiceSamplePath',async()=>{

        const voice = await this.getVoice(voiceId);
        if (!voice || !voice.isDownloaded) return null;
        return voice.samplePath;
    
        });
}

    // Private helpers

    private getDownloadedCount(): number {
        return Array.from(this.voices.values()).filter(v => v.isDownloaded).length;
    }

    private async downloadFile(url:string,destPath:string,voiceId:string):Promise<void>{
        const receipt:DownloadReceipt={state:'PENDING',destination:destPath,requestCount:0,requestsClosed:0,responsesClosed:0,
            fileClosed:false,fileFinished:false,fileApplied:false,poolRelease:'UNVERIFIED',crashDurability:'UNVERIFIED'};
        this.downloadReceipts.set(voiceId,receipt);
        await downloadOwnedHttpsFile(this.operations,url,receipt);
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
            this.metadataUncertain=true;this.operations.recordFailure('voice-library-metadata-load',e);
            this.pendingMutations.push({operation:'load',phase:'METADATA_UNKNOWN',error:e});
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
            const readback=sqliteService.getConfig('voice_library');
            if(JSON.stringify(readback)!==JSON.stringify(all))throw new Error('Voice metadata readback mismatch');
        } catch (e) {
            this.metadataUncertain=true;this.operations.recordFailure('voice-library-metadata-write-or-readback',e);
            this.pendingMutations.push({operation:'save',phase:'FILE_OR_MEMORY_APPLIED_METADATA_UNKNOWN_NO_REPLAY',error:e});
            console.warn('[VOICE_LIBRARY] Failed to save to database:', e);
            throw e;
        }
    }

    private async deleteFromDatabase(voiceId: string): Promise<void> {
        await this.saveToDatabase({ id: voiceId } as Voice); // Will save all remaining voices
    }
}

export const voiceLibraryService = VoiceLibraryService.getInstance();
