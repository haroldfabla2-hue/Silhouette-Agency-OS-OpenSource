import { resourceManagerOwner } from './lifecycle/preparationBindings';
import { AdmissionClosed, type Operation } from './lifecycle/host';
import { admitEvaluatedResourceManager, bindEvaluatedResourceManager, failEvaluatedResourceManager } from './lifecycle/runtimeStopBindings';

import { ollamaService } from './ollamaService';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

type ResourceClient = 'LLM' | 'VIDEO' | 'TRAINING' | 'IDLE';

class ResourceManager {
    private readonly ownership = resourceManagerOwner();
    private knownWorkSealed = false;
    private readonly knownWork = new Set<Promise<unknown>>();
    private knownDrain: Promise<void> | undefined;
    private admitKnown<T>(source: string, original: () => Promise<T>): Promise<T> {
        if (this.knownWorkSealed) throw new AdmissionClosed(source);
        const work = this.ownership.invoke(source, original);
        this.knownWork.add(work);
        const settled = () => { this.knownWork.delete(work); };
        void work.then(settled, settled);
        return work;
    }
    /** Wait original shunt/restore promises before sealing downstream TTS.
     * The current exclusive lease still belongs to its original client; do not
     * manufacture release, warm a model or revoke that client's authority.
     */
    public sealAndDrainKnownWork(): Promise<void> {
        if (this.knownDrain) return this.knownDrain;
        this.knownWorkSealed = true;
        this.knownDrain = Promise.allSettled([...this.knownWork]).then(results => {
            if (this.currentOwner === 'VIDEO' || this.currentOwner === 'TRAINING')
                this.ownership.unknown('EXCLUSIVE_CLIENT_LEASE_LIFETIME_UNVERIFIED', true);
            const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
            if (errors.length) throw new AggregateError(errors, 'Known resource-manager work drain failed');
        });
        void this.knownDrain.catch(() => undefined);
        return this.knownDrain;
    }
    private currentOwner: ResourceClient = 'LLM';
    private lockPromise: Promise<void> | null = null;

    // Default LLM Model to restore (unified to GLM-4 Light)
    private defaultLlmModel = 'glm4:light';

    constructor(operation: Operation) {
        this.ownership.validateConstruction(operation);
        // Listen for Video Requests (if we implement event-driven video later)
        console.log("[RESOURCE MANAGER] 🛡️ Initialized. VRAM Guardian active.");
    }

    public async requestExclusiveAccess(client: 'VIDEO' | 'TRAINING'): Promise<boolean> {
        return this.admitKnown('original-request-access', () => this.requestExclusiveAccessOriginal(client));
    }
    private async requestExclusiveAccessOriginal(client: 'VIDEO' | 'TRAINING'): Promise<boolean> {
        if (this.currentOwner === client) return true;

        if (client === 'VIDEO') {
            return this.shuntToVideo();
        }
        if (client === 'TRAINING') {
            return this.shuntToTraining();
        }
        return false;
    }

    public async releaseExclusiveAccess(client: 'VIDEO' | 'TRAINING'): Promise<void> {
        return this.admitKnown('original-release-access', () => this.releaseExclusiveAccessOriginal(client));
    }
    private async releaseExclusiveAccessOriginal(client: 'VIDEO' | 'TRAINING'): Promise<void> {
        if (client === 'VIDEO' && this.currentOwner === 'VIDEO') {
            await this.restoreLlm();
        }
        if (client === 'TRAINING' && this.currentOwner === 'TRAINING') {
            await this.restoreFromTraining();
        }
    }

    private async shuntToVideo(): Promise<boolean> {
        console.log("[RESOURCE MANAGER] 🔌 SHUNTING RESOURCES: LLM -> VIDEO");

        // 1. Notify System (Pause Chat)
        systemBus.emit(SystemProtocol.RESOURCE_SHUNT, {
            status: 'ACTIVE',
            message: 'Hibernating Local Brain for Video Generation...'
        });

        // 2. Unload Ollama (only GLM-4 Light now - unified model)
        try {
            // Unload unified local model
            await ollamaService.unloadModel('glm4:light');

            // Give it a second to clear VRAM
            await new Promise(resolve => setTimeout(resolve, 1000));

            this.currentOwner = 'VIDEO';
            return true;

        } catch (e) {
            console.error("[RESOURCE MANAGER] ❌ Shunt Failed:", e);
            // Restore immediately if fail
            this.currentOwner = 'LLM';
            systemBus.emit(SystemProtocol.RESOURCE_SHUNT, { status: 'FAILED' });
            return false;
        }
    }

    /**
     * Shunt resources for Silhouette training
     * Hibernates BOTH TTS and Ollama to maximize available VRAM
     */
    private async shuntToTraining(): Promise<boolean> {
        console.log("[RESOURCE MANAGER] 🔌 SHUNTING RESOURCES: ALL -> TRAINING (Silhouette)");

        // 1. Notify System
        systemBus.emit(SystemProtocol.RESOURCE_SHUNT, {
            status: 'ACTIVE',
            message: 'Hibernating all GPU services for Silhouette training...'
        });

        try {
            // 2. Sleep TTS Engine (frees ~1-2GB VRAM)
            const { ttsService } = await import('./ttsService');
            await ttsService.sleep();
            console.log("[RESOURCE MANAGER] 💤 TTS Engine sleeping...");

            // 3. Unload Ollama
            await ollamaService.unloadModel('glm4:light');
            console.log("[RESOURCE MANAGER] 💤 Ollama GLM-4 unloaded...");

            // Give it a moment to clear VRAM
            await new Promise(resolve => setTimeout(resolve, 1500));

            this.currentOwner = 'TRAINING';
            console.log("[RESOURCE MANAGER] ✅ VRAM cleared for Silhouette training");
            return true;

        } catch (e) {
            console.error("[RESOURCE MANAGER] ❌ Training Shunt Failed:", e);
            this.currentOwner = 'LLM';
            systemBus.emit(SystemProtocol.RESOURCE_SHUNT, { status: 'FAILED' });
            return false;
        }
    }

    private async restoreLlm(): Promise<void> {
        console.log("[RESOURCE MANAGER] 🔋 RESTORING RESOURCES: VIDEO -> LLM");

        try {
            // 1. Pre-load default model (warmup)
            // We just send a tiny ping to make sure it loads
            await ollamaService.generateSimpleResponse("System reboot check.");

            this.currentOwner = 'LLM';

            // 2. Notify System (Resume Chat)
            systemBus.emit(SystemProtocol.RESOURCE_SHUNT, {
                status: 'COMPLETED',
                message: 'Local Brain restored.'
            });

        } catch (e) {
            console.error("[RESOURCE MANAGER] ⚠️ Restore Loop Warning:", e);
            // Even if warmup fails, we mark as LLM so retries can happen normally
            this.currentOwner = 'LLM';
        }
    }

    /**
     * Restore resources after Silhouette training completes
     * Wakes up TTS and Ollama
     */
    private async restoreFromTraining(): Promise<void> {
        console.log("[RESOURCE MANAGER] 🔋 RESTORING RESOURCES: TRAINING -> LLM");

        try {
            // 1. Wake TTS Engine
            const { ttsService } = await import('./ttsService');
            await ttsService.wake();
            console.log("[RESOURCE MANAGER] ☀️ TTS Engine waking up...");

            // 2. Warm up Ollama
            await ollamaService.generateSimpleResponse("Neural training complete. Resuming operations.");
            console.log("[RESOURCE MANAGER] ☀️ Ollama GLM-4 restored...");

            this.currentOwner = 'LLM';

            // 3. Notify System
            systemBus.emit(SystemProtocol.RESOURCE_SHUNT, {
                status: 'COMPLETED',
                message: 'All services restored after training.'
            });

        } catch (e) {
            console.error("[RESOURCE MANAGER] ⚠️ Training Restore Warning:", e);
            this.currentOwner = 'LLM';
        }
    }

    public getCurrentOwner(): ResourceClient {
        return this.currentOwner;
    }
}

function constructOriginalResourceManager(): ResourceManager {
    const permit = admitEvaluatedResourceManager();
    try {
        const owner = resourceManagerOwner();
        const operation = owner.beginConstruction();
        let original: ResourceManager;
        try { original = new ResourceManager(operation); }
        catch (error) { owner.constructionFailed(operation, error); throw error; }
        owner.constructed(operation, original);
        bindEvaluatedResourceManager(permit, () => original.sealAndDrainKnownWork());
        return original;
    } catch (error) { failEvaluatedResourceManager(permit, error); throw error; }
}
export const resourceManager = constructOriginalResourceManager();
