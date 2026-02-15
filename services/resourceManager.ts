
import { ollamaService } from './ollamaService';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

type ResourceClient = 'LLM' | 'VIDEO' | 'TRAINING' | 'IDLE';

class ResourceManager {
    private currentOwner: ResourceClient = 'LLM';
    private lockPromise: Promise<void> | null = null;

    // Default LLM Model to restore (unified to GLM-4 Light)
    private defaultLlmModel = 'glm4:light';

    constructor() {
        // Listen for Video Requests (if we implement event-driven video later)
        console.log("[RESOURCE MANAGER] 🛡️ Initialized. VRAM Guardian active.");
    }

    public async requestExclusiveAccess(client: 'VIDEO' | 'TRAINING'): Promise<boolean> {
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

export const resourceManager = new ResourceManager();
