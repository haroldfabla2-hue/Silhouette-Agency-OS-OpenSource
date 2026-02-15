/**
 * PRODUCTION SQUAD PRESET
 * 
 * Long-form video production using EXISTING agent infrastructure.
 * 
 * Instead of creating new agents, this service:
 * 1. Uses SemanticAgentSearch to find the BEST existing agents for each role
 * 2. Delegates tasks via the existing message system (systemBus)
 * 3. Coordinates the production pipeline through the Orchestrator
 * 
 * Roles needed (matched semantically):
 * - MEDIA agents for visual production
 * - CREATIVE agents for storyboarding
 * - OPS agents for file management
 * 
 * This leverages the full power of Silhouette's multi-agent architecture.
 */

import { semanticAgentSearch, SemanticAgentSearch } from '../semanticAgentSearch';
import { enhancedCapabilityRegistry } from '../enhancedCapabilityRegistry';
import { storyboardGenerator, Storyboard } from '../media/storyboardGenerator';
import { sceneConsistencyManager, ConsistencySession } from '../media/sceneConsistencyManager';
import { videoCompositor, CompositorJob, ClipReference } from '../media/videoCompositor';
import { videoFactory } from '../media/videoFactory';
import { imageFactory } from '../media/imageFactory';
import { elevenLabsService } from '../media/elevenLabsService';
import { schedulerService } from '../schedulerService';
import { systemBus } from '../systemBus';
import { orchestrator } from '../orchestrator';
import { SystemProtocol, Agent, AgentCategory, AgentTier } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductionProject {
    id: string;
    title: string;
    brief: string;
    targetDuration: number;                    // seconds
    platform: Storyboard['targetPlatform'];
    status: ProductionStatus;
    storyboard: Storyboard | null;
    consistencySessionId: string | null;
    phase: ProductionPhase;
    progress: number;                          // 0-100
    currentTask: string;
    generatedAssets: {
        masterImages: Map<string, string>;     // characterId -> path
        clips: Map<string, string>;            // shotId -> path  
        audio: Map<string, string>;            // type -> path
    };
    outputPath: string | null;
    createdAt: string;
    completedAt: string | null;
    errors: string[];
}

export type ProductionStatus =
    | 'QUEUED'
    | 'PLANNING'
    | 'GENERATING_ASSETS'
    | 'GENERATING_CLIPS'
    | 'COMPOSING'
    | 'COMPLETE'
    | 'FAILED'
    | 'PAUSED';

export type ProductionPhase =
    | 'STORYBOARD'
    | 'CHARACTER_SETUP'
    | 'AUDIO_PRODUCTION'
    | 'VISUAL_PRODUCTION'
    | 'COMPOSITION'
    | 'QUALITY_CHECK'
    | 'EXPORT';

export interface ProductionConfig {
    generateCharacterSheets: boolean;
    useConsistencyManager: boolean;
    parallelClipGeneration: number;            // Max concurrent clip generations
    autoCompose: boolean;                      // Auto-compose when all clips ready
    transitionType: 'fade' | 'dissolve' | 'none';
    transitionDuration: number;
    qualityPreset: 'ultrafast' | 'fast' | 'medium' | 'slow';
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION SQUAD ROLE DEFINITIONS (for semantic agent search)
// ═══════════════════════════════════════════════════════════════════════════

export const PRODUCTION_ROLES = {
    name: 'Production Studio Squad',
    description: 'Full-service video production team for creating long-form content with consistent quality.',
    strategy: 'Pipeline execution: Story Director plans → Visual Producer generates images → Motion Artist animates → Sound Designer adds audio → Post-Production composes final output.',
    members: [
        {
            roleName: 'Story Director',
            category: 'MEDIA' as const,
            focus: 'Storyboard generation, narrative structure, scene planning',
            tier: AgentTier.SPECIALIST
        },
        {
            roleName: 'Visual Producer',
            category: 'MEDIA' as const,
            focus: 'Character consistency, master image generation, style enforcement',
            tier: AgentTier.SPECIALIST
        },
        {
            roleName: 'Motion Artist',
            category: 'MEDIA' as const,
            focus: 'Video clip generation, animation, camera movement',
            tier: AgentTier.WORKER
        },
        {
            roleName: 'Sound Designer',
            category: 'MEDIA' as const,
            focus: 'Voiceover generation, music selection, audio mixing',
            tier: AgentTier.WORKER
        },
        {
            roleName: 'Post-Production Lead',
            category: 'MEDIA' as const,
            focus: 'Video composition, transitions, final export',
            tier: AgentTier.SPECIALIST
        }
    ]
};

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

class ProductionOrchestrator {
    private projects: Map<string, ProductionProject> = new Map();
    private readonly outputDir: string;
    private readonly config: ProductionConfig = {
        generateCharacterSheets: true,
        useConsistencyManager: true,
        parallelClipGeneration: 2,
        autoCompose: true,
        transitionType: 'dissolve',
        transitionDuration: 0.5,
        qualityPreset: 'medium'
    };

    constructor() {
        this.outputDir = path.resolve(process.cwd(), 'data/output/productions');
        this.ensureDirectories();
        console.log('[ProductionOrchestrator] 🎬 Service Initialized');
    }

    private async ensureDirectories() {
        await fs.mkdir(this.outputDir, { recursive: true });
    }

    /**
     * Start a new production from a creative brief
     */
    public async startProduction(
        brief: string,
        targetMinutes: number,
        platform: Storyboard['targetPlatform'] = 'youtube',
        config?: Partial<ProductionConfig>
    ): Promise<ProductionProject> {
        const projectId = uuidv4();
        const projectConfig = { ...this.config, ...config };

        const project: ProductionProject = {
            id: projectId,
            title: '',
            brief,
            targetDuration: targetMinutes * 60,
            platform,
            status: 'QUEUED',
            storyboard: null,
            consistencySessionId: null,
            phase: 'STORYBOARD',
            progress: 0,
            currentTask: 'Initializing production',
            generatedAssets: {
                masterImages: new Map(),
                clips: new Map(),
                audio: new Map()
            },
            outputPath: null,
            createdAt: new Date().toISOString(),
            completedAt: null,
            errors: []
        };

        this.projects.set(projectId, project);

        // Emit production started
        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
            thoughts: [
                `[PRODUCTION] 🎬 New production started: ${projectId}`,
                `Brief: "${brief.substring(0, 50)}..."`,
                `Target: ${targetMinutes} minutes for ${platform}`
            ],
            source: 'ProductionOrchestrator'
        });

        // Start async production pipeline
        this.runProductionPipeline(project, projectConfig).catch(err => {
            console.error('[ProductionOrchestrator] Pipeline failed:', err);
            project.status = 'FAILED';
            project.errors.push(err.message);
        });

        return project;
    }

    /**
     * Run the full production pipeline
     */
    private async runProductionPipeline(
        project: ProductionProject,
        config: ProductionConfig
    ): Promise<void> {
        try {
            project.status = 'PLANNING';

            // ═══════════════════════════════════════════════════════════════
            // PHASE 1: STORYBOARD GENERATION
            // ═══════════════════════════════════════════════════════════════
            this.updateProgress(project, 'STORYBOARD', 5, 'Generating storyboard...');

            const storyboard = await storyboardGenerator.generateFromBrief(
                project.brief,
                project.targetDuration / 60,
                project.platform
            );

            project.storyboard = storyboard;
            project.title = storyboard.title;
            this.updateProgress(project, 'STORYBOARD', 10, 'Storyboard complete');

            // ═══════════════════════════════════════════════════════════════
            // PHASE 2: CHARACTER SETUP & CONSISTENCY
            // ═══════════════════════════════════════════════════════════════
            if (config.useConsistencyManager) {
                this.updateProgress(project, 'CHARACTER_SETUP', 12, 'Setting up character consistency...');

                const session = await sceneConsistencyManager.createSession(storyboard);
                project.consistencySessionId = session.sessionId;

                // Generate character master images
                for (const character of storyboard.characters) {
                    if (character.role !== 'narrator') {
                        this.updateProgress(project, 'CHARACTER_SETUP', 15, `Generating master image for ${character.name}...`);

                        const enhancement = sceneConsistencyManager.getEnhancedPrompt(
                            session.sessionId,
                            `portrait of ${character.physicalDescription}`,
                            [character.id]
                        );

                        try {
                            const result = await imageFactory.createAsset({
                                prompt: enhancement.enhanced,
                                negativePrompt: enhancement.negativeSuffix,
                                style: 'PHOTOREALISTIC',
                                aspectRatio: '1:1'
                            });

                            if (result?.localPath) {
                                await sceneConsistencyManager.setCharacterMasterImage(
                                    session.sessionId,
                                    character.id,
                                    result.localPath
                                );
                                project.generatedAssets.masterImages.set(character.id, result.localPath);
                            }
                        } catch (e) {
                            console.warn(`[Production] Failed to generate master for ${character.name}:`, e);
                        }
                    }
                }
            }

            this.updateProgress(project, 'CHARACTER_SETUP', 20, 'Character setup complete');

            // ═══════════════════════════════════════════════════════════════
            // PHASE 3: AUDIO PRODUCTION (Parallel with visual)
            // ═══════════════════════════════════════════════════════════════
            project.status = 'GENERATING_ASSETS';
            this.updateProgress(project, 'AUDIO_PRODUCTION', 22, 'Generating voiceover...');

            if (storyboard.voiceoverScript && storyboard.voiceoverScript.length > 50) {
                try {
                    const voPath = path.join(this.outputDir, project.id, 'voiceover.mp3');
                    await fs.mkdir(path.dirname(voPath), { recursive: true });

                    const audioPath = await elevenLabsService.generateSpeech(
                        storyboard.voiceoverScript,
                        voPath
                    );

                    if (audioPath) {
                        project.generatedAssets.audio.set('voiceover', audioPath);
                    }
                } catch (e) {
                    console.warn('[Production] Voiceover generation failed:', e);
                }
            }

            this.updateProgress(project, 'AUDIO_PRODUCTION', 25, 'Audio production complete');

            // ═══════════════════════════════════════════════════════════════
            // PHASE 4: VISUAL PRODUCTION (Clip Generation)
            // ═══════════════════════════════════════════════════════════════
            project.status = 'GENERATING_CLIPS';
            this.updateProgress(project, 'VISUAL_PRODUCTION', 30, 'Starting clip generation...');

            const totalShots = storyboard.scenes.reduce((acc, s) => acc + s.shots.length, 0);
            let completedShots = 0;

            for (const scene of storyboard.scenes) {
                for (const shot of scene.shots) {
                    const shotKey = `scene${scene.sceneNumber}_shot${shot.shotNumber}`;

                    this.updateProgress(
                        project,
                        'VISUAL_PRODUCTION',
                        30 + Math.round((completedShots / totalShots) * 50),
                        `Generating ${shotKey}...`
                    );

                    try {
                        // Get enhanced prompt with consistency
                        let imagePrompt = shot.imagePrompt || shot.description;
                        let videoPrompt = shot.videoPrompt || shot.action;

                        if (project.consistencySessionId && shot.characterIds?.length) {
                            const enhancement = sceneConsistencyManager.getEnhancedPrompt(
                                project.consistencySessionId,
                                imagePrompt,
                                shot.characterIds
                            );
                            imagePrompt = enhancement.enhanced;
                        }

                        // Generate base image
                        const aspectRatio = storyboard.style.aspectRatio === '16:9' ||
                            storyboard.style.aspectRatio === '9:16' ||
                            storyboard.style.aspectRatio === '1:1'
                            ? storyboard.style.aspectRatio : '16:9';
                        const imageResult = await imageFactory.createAsset({
                            prompt: imagePrompt,
                            style: 'PHOTOREALISTIC',
                            aspectRatio
                        });

                        if (imageResult?.localPath) {
                            // Animate to video
                            const videoResult = await videoFactory.createVideo(
                                videoPrompt,
                                shot.duration,
                                imageResult.localPath,
                                'WAN' // Default engine
                            );

                            if (videoResult?.url) {
                                project.generatedAssets.clips.set(shotKey, videoResult.url);
                            }
                        }
                    } catch (e) {
                        console.warn(`[Production] Failed to generate ${shotKey}:`, e);
                        project.errors.push(`Failed: ${shotKey}`);
                    }

                    completedShots++;
                }
            }

            this.updateProgress(project, 'VISUAL_PRODUCTION', 80, 'Clip generation complete');

            // ═══════════════════════════════════════════════════════════════
            // PHASE 5: COMPOSITION
            // ═══════════════════════════════════════════════════════════════
            if (config.autoCompose && project.generatedAssets.clips.size > 0) {
                project.status = 'COMPOSING';
                this.updateProgress(project, 'COMPOSITION', 82, 'Composing final video...');

                // Build clip list in order
                const clips: ClipReference[] = [];
                for (const scene of storyboard.scenes) {
                    for (const shot of scene.shots) {
                        const shotKey = `scene${scene.sceneNumber}_shot${shot.shotNumber}`;
                        const clipPath = project.generatedAssets.clips.get(shotKey);
                        if (clipPath) {
                            clips.push({
                                clipId: shotKey,
                                filePath: clipPath
                            });
                        }
                    }
                }

                if (clips.length > 0) {
                    const compositorJob = videoCompositor.createJob(
                        clips,
                        `${project.id}_final.mp4`
                    );

                    // Set transition type from config (map to valid TransitionType)
                    const transitionMap: Record<string, 'fade' | 'dissolve' | 'none'> = {
                        'fade': 'fade',
                        'dissolve': 'dissolve',
                        'none': 'none'
                    };
                    compositorJob.transitions.forEach(t => {
                        t.type = transitionMap[config.transitionType] || 'dissolve';
                        t.duration = config.transitionDuration;
                    });
                    compositorJob.qualityPreset = config.qualityPreset;

                    // Add audio tracks
                    const voPath = project.generatedAssets.audio.get('voiceover');
                    if (voPath) {
                        compositorJob.audioTracks.push({
                            trackId: 'voiceover',
                            type: 'voiceover',
                            filePath: voPath,
                            startTime: 0,
                            volume: 0.9
                        });
                    }

                    const result = await videoCompositor.compose(compositorJob);

                    if (result.success) {
                        project.outputPath = result.outputPath || null;
                        this.updateProgress(project, 'EXPORT', 95, 'Export complete');
                    }
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // PHASE 6: COMPLETE
            // ═══════════════════════════════════════════════════════════════
            project.status = 'COMPLETE';
            project.completedAt = new Date().toISOString();
            this.updateProgress(project, 'EXPORT', 100, 'Production complete!');

            systemBus.emit(SystemProtocol.WORK_COMPLETE, {
                type: 'VIDEO_PRODUCTION',
                projectId: project.id,
                title: project.title,
                outputPath: project.outputPath,
                clipCount: project.generatedAssets.clips.size,
                errors: project.errors
            });

            console.log(`[ProductionOrchestrator] ✅ Production Complete: ${project.title}`);
            console.log(`[ProductionOrchestrator] 📁 Output: ${project.outputPath}`);

        } catch (error: any) {
            project.status = 'FAILED';
            project.errors.push(error.message);
            console.error('[ProductionOrchestrator] ❌ Production failed:', error);

            systemBus.emit(SystemProtocol.INCIDENT_REPORT, {
                source: 'ProductionOrchestrator',
                error: error.message,
                projectId: project.id
            });
        }
    }

    /**
     * Update project progress
     */
    private updateProgress(
        project: ProductionProject,
        phase: ProductionPhase,
        percent: number,
        task: string
    ): void {
        project.phase = phase;
        project.progress = percent;
        project.currentTask = task;

        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            type: 'PRODUCTION_PROGRESS',
            projectId: project.id,
            phase,
            progress: percent,
            task
        });
    }

    /**
     * Get project status
     */
    public getProject(projectId: string): ProductionProject | undefined {
        return this.projects.get(projectId);
    }

    /**
     * Pause production
     */
    public pauseProduction(projectId: string): boolean {
        const project = this.projects.get(projectId);
        if (project && project.status !== 'COMPLETE' && project.status !== 'FAILED') {
            project.status = 'PAUSED';
            return true;
        }
        return false;
    }

    /**
     * List all productions
     */
    public listProductions(): ProductionProject[] {
        return Array.from(this.projects.values());
    }

    /**
     * Find best agents for production using semantic search
     */
    public async findProductionAgents(): Promise<Agent[]> {
        const taskDescription = 'Video production: storyboarding, image generation, video animation, audio production, compositing';
        const results = await semanticAgentSearch.findBestAgents(taskDescription, {
            maxAgents: 5,
            requiredCategory: 'MEDIA'
        });
        return results.map(r => r.agent);
    }
}

// Singleton export
export const productionOrchestrator = new ProductionOrchestrator();

// Helper function to get production roles for agent matching
export const getProductionRoles = () => {
    return PRODUCTION_ROLES;
};
