/**
 * SCENE CONSISTENCY MANAGER
 * 
 * Maintains visual consistency across video production:
 * - Character appearance tracking via reference images
 * - Style consistency via seed locking
 * - Prompt suffix generation for consistent AI generation
 * 
 * Integrates with:
 * - IP-Adapter (FaceID) for facial consistency
 * - LoRA registry for trained character models
 * - imageFactory for consistent image generation
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { CharacterDefinition, StyleGuide, Storyboard } from './storyboardGenerator';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ConsistencySession {
    sessionId: string;
    projectId: string;
    characters: Map<string, CharacterState>;
    styleSeed: number;
    globalNegativePrompt: string;
    styleGuide: StyleGuide;
    colorPalette: string[];
    createdAt: string;
}

export interface CharacterState {
    characterId: string;
    name: string;
    masterImage: string | null;        // Path to reference image
    characterSheet: string[];          // Multiple angle references
    loraModel: string | null;          // Path to trained LoRA
    stylePromptSuffix: string;         // Consistent description
    lastGeneratedFrame: string | null; // For temporal consistency
    frameHistory: string[];            // Last N generated frames
    consistencyScore: number;          // 0-1 score
}

export interface ConsistencyConfig {
    useIPAdapter: boolean;
    useFaceID: boolean;
    enforceColorPalette: boolean;
    seedLocking: boolean;
    historyFrameCount: number;
}

export interface PromptEnhancement {
    enhanced: string;
    characterSuffix: string;
    styleSuffix: string;
    negativeSuffix: string;
    seed: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE CONSISTENCY MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

class SceneConsistencyManager {
    private sessions: Map<string, ConsistencySession> = new Map();
    private readonly dataDir: string;
    private readonly defaultConfig: ConsistencyConfig = {
        useIPAdapter: true,
        useFaceID: true,
        enforceColorPalette: true,
        seedLocking: true,
        historyFrameCount: 5
    };

    constructor() {
        this.dataDir = path.resolve(process.cwd(), 'data/consistency');
        this.ensureDirectories();
        console.log('[ConsistencyManager] 🎨 Service Initialized');
    }

    private async ensureDirectories() {
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.mkdir(path.join(this.dataDir, 'character_sheets'), { recursive: true });
        await fs.mkdir(path.join(this.dataDir, 'reference_images'), { recursive: true });
    }

    /**
     * Create a new consistency session from a storyboard
     */
    public async createSession(storyboard: Storyboard): Promise<ConsistencySession> {
        const sessionId = uuidv4();

        // Initialize character states
        const characters = new Map<string, CharacterState>();

        for (const char of storyboard.characters) {
            characters.set(char.id, {
                characterId: char.id,
                name: char.name,
                masterImage: char.referenceImagePath || null,
                characterSheet: [],
                loraModel: char.loraPath || null,
                stylePromptSuffix: char.stylePromptSuffix,
                lastGeneratedFrame: null,
                frameHistory: [],
                consistencyScore: 1.0
            });
        }

        // Generate consistent seed from project ID
        const styleSeed = this.generateSeedFromString(storyboard.id);

        const session: ConsistencySession = {
            sessionId,
            projectId: storyboard.id,
            characters,
            styleSeed,
            globalNegativePrompt: storyboard.style.negativePrompt,
            styleGuide: storyboard.style,
            colorPalette: storyboard.style.colorPalette,
            createdAt: new Date().toISOString()
        };

        this.sessions.set(sessionId, session);

        // Persist session
        await this.saveSession(session);

        console.log(`[ConsistencyManager] 📋 Session Created: ${sessionId}`);
        console.log(`[ConsistencyManager] 👥 Characters: ${storyboard.characters.map(c => c.name).join(', ')}`);
        console.log(`[ConsistencyManager] 🎨 Style Seed: ${styleSeed}`);

        return session;
    }

    /**
     * Get enhanced prompt with consistency parameters
     */
    public getEnhancedPrompt(
        sessionId: string,
        basePrompt: string,
        characterIds?: string[]
    ): PromptEnhancement {
        const session = this.sessions.get(sessionId);

        if (!session) {
            console.warn(`[ConsistencyManager] Session not found: ${sessionId}`);
            return {
                enhanced: basePrompt,
                characterSuffix: '',
                styleSuffix: '',
                negativeSuffix: '',
                seed: Math.floor(Math.random() * 1000000)
            };
        }

        // Build character suffix
        let characterSuffix = '';
        if (characterIds && characterIds.length > 0) {
            const charDescriptions = characterIds
                .map(id => session.characters.get(id)?.stylePromptSuffix)
                .filter(Boolean);
            characterSuffix = charDescriptions.join(', ');
        }

        // Build style suffix from guide
        const styleSuffix = [
            session.styleGuide.visualStyle,
            ...session.styleGuide.moodKeywords
        ].join(', ');

        // Build negative prompt
        const negativeSuffix = session.globalNegativePrompt;

        // Compose enhanced prompt
        const enhanced = [
            basePrompt,
            characterSuffix,
            styleSuffix
        ].filter(Boolean).join(', ');

        return {
            enhanced,
            characterSuffix,
            styleSuffix,
            negativeSuffix,
            seed: session.styleSeed
        };
    }

    /**
     * Get reference image path for a character
     */
    public getCharacterReference(sessionId: string, characterId: string): string | null {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        const character = session.characters.get(characterId);
        return character?.masterImage || null;
    }

    /**
     * Set master reference image for a character
     */
    public async setCharacterMasterImage(
        sessionId: string,
        characterId: string,
        imagePath: string
    ): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        const character = session.characters.get(characterId);
        if (!character) return false;

        // Copy to reference images directory
        const filename = `${characterId}_master${path.extname(imagePath)}`;
        const destPath = path.join(this.dataDir, 'reference_images', filename);

        try {
            await fs.copyFile(imagePath, destPath);
            character.masterImage = destPath;
            await this.saveSession(session);

            console.log(`[ConsistencyManager] 🖼️ Master image set for ${character.name}`);
            return true;
        } catch (e) {
            console.error(`[ConsistencyManager] Failed to set master image:`, e);
            return false;
        }
    }

    /**
     * Add generated frame to character history (for temporal consistency)
     */
    public addFrameToHistory(
        sessionId: string,
        characterId: string,
        framePath: string
    ): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const character = session.characters.get(characterId);
        if (!character) return;

        character.lastGeneratedFrame = framePath;
        character.frameHistory.push(framePath);

        // Keep only last N frames
        if (character.frameHistory.length > this.defaultConfig.historyFrameCount) {
            character.frameHistory.shift();
        }
    }

    /**
     * Generate a character sheet (multiple angles/expressions)
     * This is used to create training data for LoRA or reference for IP-Adapter
     */
    public async generateCharacterSheet(
        sessionId: string,
        characterId: string,
        imageFactory: any // Avoid circular import
    ): Promise<string[]> {
        const session = this.sessions.get(sessionId);
        if (!session) return [];

        const character = session.characters.get(characterId);
        if (!character) return [];

        const angles = ['front view', 'side profile', 'three-quarter view'];
        const expressions = ['neutral', 'smiling', 'serious'];

        const sheetPath = path.join(this.dataDir, 'character_sheets', characterId);
        await fs.mkdir(sheetPath, { recursive: true });

        const generatedImages: string[] = [];

        for (const angle of angles) {
            for (const expression of expressions) {
                const prompt = `${character.stylePromptSuffix}, ${angle}, ${expression} expression, portrait, white background, character reference sheet, high quality`;

                try {
                    const result = await imageFactory.createAsset({
                        prompt,
                        style: 'PHOTOREALISTIC',
                        aspectRatio: '1:1',
                        seed: session.styleSeed // Use consistent seed
                    });

                    if (result?.localPath) {
                        const destPath = path.join(sheetPath, `${angle.replace(' ', '_')}_${expression}.png`);
                        await fs.copyFile(result.localPath, destPath);
                        generatedImages.push(destPath);
                    }
                } catch (e) {
                    console.warn(`[ConsistencyManager] Failed to generate ${angle} ${expression}:`, e);
                }
            }
        }

        character.characterSheet = generatedImages;
        await this.saveSession(session);

        console.log(`[ConsistencyManager] 📋 Generated character sheet: ${generatedImages.length} images`);

        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
            thoughts: [`[CONSISTENCY] Generated character sheet for ${character.name}: ${generatedImages.length} reference images`],
            source: 'ConsistencyManager'
        });

        return generatedImages;
    }

    /**
     * Calculate consistency score between two images
     * (Placeholder - would use actual image comparison in production)
     */
    public async calculateConsistencyScore(
        referenceImage: string,
        generatedImage: string
    ): Promise<number> {
        // In production, this would use:
        // - CLIP embeddings comparison
        // - Face recognition similarity
        // - Color histogram matching

        // For now, return placeholder
        return 0.85;
    }

    /**
     * Get IP-Adapter configuration for ComfyUI
     */
    public getIPAdapterConfig(sessionId: string, characterId: string): {
        enabled: boolean;
        referenceImage: string | null;
        strength: number;
    } {
        const session = this.sessions.get(sessionId);
        if (!session) return { enabled: false, referenceImage: null, strength: 0 };

        const character = session.characters.get(characterId);
        if (!character || !character.masterImage) {
            return { enabled: false, referenceImage: null, strength: 0 };
        }

        return {
            enabled: true,
            referenceImage: character.masterImage,
            strength: 0.7 // Balanced - not too strong to prevent overfitting
        };
    }

    /**
     * Generate seed from string (deterministic)
     */
    private generateSeedFromString(input: string): number {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash) % 1000000;
    }

    /**
     * Save session to disk
     */
    private async saveSession(session: ConsistencySession): Promise<void> {
        const filePath = path.join(this.dataDir, `session_${session.sessionId}.json`);

        const serializable = {
            ...session,
            characters: Array.from(session.characters.entries())
        };

        await fs.writeFile(filePath, JSON.stringify(serializable, null, 2));
    }

    /**
     * Load session from disk
     */
    public async loadSession(sessionId: string): Promise<ConsistencySession | null> {
        const filePath = path.join(this.dataDir, `session_${sessionId}.json`);

        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(data);

            const session: ConsistencySession = {
                ...parsed,
                characters: new Map(parsed.characters)
            };

            this.sessions.set(sessionId, session);
            return session;
        } catch (e) {
            return null;
        }
    }

    /**
     * Get session summary
     */
    public getSessionSummary(sessionId: string): {
        projectId: string;
        characterCount: number;
        characters: string[];
        styleSeed: number;
    } | null {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        return {
            projectId: session.projectId,
            characterCount: session.characters.size,
            characters: Array.from(session.characters.values()).map(c => c.name),
            styleSeed: session.styleSeed
        };
    }

    /**
     * Clear session
     */
    public clearSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }
}

// Singleton export
export const sceneConsistencyManager = new SceneConsistencyManager();
