/**
 * STORYBOARD GENERATOR SERVICE
 * 
 * LLM-powered conversion of creative briefs into structured storyboards:
 * - Brief → Narrative Arc
 * - Narrative → Scenes
 * - Scenes → Shots with camera directions
 * - Character extraction and tracking
 * 
 * Inspired by HeyGen's text-first architecture where script anchors all assets.
 */

import { v4 as uuidv4 } from 'uuid';
import { backgroundLLM } from '../backgroundLLMService';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Storyboard {
    id: string;
    title: string;
    brief: string;
    targetDuration: number;           // Total duration in seconds
    targetPlatform: 'youtube' | 'reels' | 'tiktok' | 'cinema' | 'ad' | 'documentary';
    scenes: Scene[];
    characters: CharacterDefinition[];
    style: StyleGuide;
    voiceoverScript?: string;         // Full VO script for the video
    metadata: {
        createdAt: string;
        estimatedClips: number;
        estimatedProductionTime: string;
    };
}

export interface Scene {
    sceneNumber: number;
    title: string;
    description: string;
    purpose: 'intro' | 'problem' | 'solution' | 'demo' | 'story' | 'climax' | 'cta' | 'outro';
    duration: number;                 // seconds
    shots: Shot[];
    audioRequirements: AudioRequirement[];
    emotionalTone: string;           // e.g. "exciting", "calm", "urgent"
}

export interface Shot {
    shotNumber: number;
    type: ShotType;
    description: string;             // What we see
    subjectDescription: string;      // Main subject (character, product, location)
    action: string;                  // What's happening
    cameraMovement?: CameraMovement;
    transition: TransitionType;      // How to transition TO this shot
    duration: number;                // seconds
    characterIds?: string[];         // Characters in this shot
    voiceoverSegment?: string;       // VO text for this shot
    imagePrompt?: string;            // Generated prompt for image AI
    videoPrompt?: string;            // Generated prompt for video AI
}

export type ShotType =
    | 'ESTABLISHING'    // Wide shot setting the scene
    | 'WIDE'            // Full scene view
    | 'MEDIUM'          // Waist-up
    | 'CLOSEUP'         // Face or detail
    | 'EXTREME_CLOSEUP' // Eyes, hands, details
    | 'POV'             // First person view
    | 'TRACKING'        // Following subject
    | 'AERIAL'          // Drone/bird's eye
    | 'OVER_SHOULDER'   // Behind character
    | 'TWO_SHOT'        // Two characters
    | 'INSERT'          // Cutaway detail
    | 'TALKING_HEAD';   // Direct to camera

export type CameraMovement =
    | 'static'
    | 'pan_left'
    | 'pan_right'
    | 'tilt_up'
    | 'tilt_down'
    | 'zoom_in'
    | 'zoom_out'
    | 'dolly_in'
    | 'dolly_out'
    | 'tracking'
    | 'crane_up'
    | 'crane_down'
    | 'orbit';

export type TransitionType =
    | 'CUT'
    | 'FADE'
    | 'DISSOLVE'
    | 'WIPE'
    | 'NONE';

export interface AudioRequirement {
    type: 'voiceover' | 'music' | 'sfx' | 'ambient';
    description: string;
    startTime?: number;
    duration?: number;
    volume?: number;
}

export interface CharacterDefinition {
    id: string;
    name: string;
    role: 'protagonist' | 'narrator' | 'supporting' | 'background';
    physicalDescription: string;
    stylePromptSuffix: string;       // e.g. "young woman, red hair, green eyes, professional attire"
    voiceDescription?: string;       // For TTS
    referenceImagePath?: string;     // If we have a reference
    loraPath?: string;               // If trained LoRA exists
}

export interface StyleGuide {
    visualStyle: string;             // e.g. "cinematic, film grain, warm golden hour"
    aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9';
    colorPalette: string[];          // e.g. ["#FF5733", "#33FF57"]
    moodKeywords: string[];          // e.g. ["professional", "modern", "clean"]
    negativePrompt: string;          // What to avoid
    referenceStyle?: string;         // e.g. "Apple commercial", "Wes Anderson"
}

// ═══════════════════════════════════════════════════════════════════════════
// STORYBOARD GENERATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class StoryboardGenerator {

    constructor() {
        console.log('[StoryboardGenerator] 🎬 Service Initialized');
    }

    /**
     * Generate a complete storyboard from a creative brief
     */
    public async generateFromBrief(
        brief: string,
        targetMinutes: number,
        platform: Storyboard['targetPlatform'] = 'youtube'
    ): Promise<Storyboard> {
        console.log(`[StoryboardGenerator] 📝 Generating storyboard for: "${brief.substring(0, 50)}..."`);
        console.log(`[StoryboardGenerator] ⏱️ Target Duration: ${targetMinutes} minutes, Platform: ${platform}`);

        const targetSeconds = targetMinutes * 60;
        const storyboardId = uuidv4();

        // 1. Generate narrative structure
        const narrativeStructure = await this.generateNarrativeStructure(brief, targetSeconds, platform);

        // 2. Extract characters
        const characters = await this.extractCharacters(brief, narrativeStructure);

        // 3. Generate style guide
        const style = await this.generateStyleGuide(brief, platform);

        // 4. Expand into detailed scenes and shots
        const scenes = await this.generateScenes(narrativeStructure, characters, targetSeconds, platform);

        // 5. Generate voiceover script
        const voiceoverScript = await this.generateVoiceoverScript(scenes);

        // Calculate metadata
        const totalShots = scenes.reduce((acc, s) => acc + s.shots.length, 0);
        const estimatedClips = totalShots;
        const estimatedHours = Math.ceil(totalShots * 0.1); // ~6 min per clip generation

        const storyboard: Storyboard = {
            id: storyboardId,
            title: await this.generateTitle(brief),
            brief,
            targetDuration: targetSeconds,
            targetPlatform: platform,
            scenes,
            characters,
            style,
            voiceoverScript,
            metadata: {
                createdAt: new Date().toISOString(),
                estimatedClips,
                estimatedProductionTime: `${estimatedHours}-${estimatedHours * 2} hours`
            }
        };

        console.log(`[StoryboardGenerator] ✅ Storyboard Generated: ${scenes.length} scenes, ${totalShots} shots`);

        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
            thoughts: [
                `[STORYBOARD] Generated storyboard: "${storyboard.title}"`,
                `Scenes: ${scenes.length}, Shots: ${totalShots}`,
                `Characters: ${characters.map(c => c.name).join(', ')}`
            ],
            source: 'StoryboardGenerator'
        });

        return storyboard;
    }

    /**
     * Generate the narrative structure (high-level story beats)
     */
    private async generateNarrativeStructure(
        brief: string,
        targetSeconds: number,
        platform: string
    ): Promise<string> {
        const prompt = `You are a professional video producer and screenwriter. 
        
Create a narrative structure for a ${Math.round(targetSeconds / 60)} minute ${platform} video based on this brief:

"${brief}"

Output a structured narrative with:
1. Opening Hook (10-15% of duration) - Grab attention immediately
2. Context/Problem (15-20%) - Set up the situation
3. Main Content (40-50%) - Core message, demonstrations, or story
4. Climax/Key Message (15-20%) - Most important takeaway
5. Call to Action/Outro (5-10%) - What viewer should do next

For each section, describe:
- What happens visually
- The emotional journey
- Key messages

Format as clear sections with timing estimates.`;

        const response = await backgroundLLM.generate(prompt, { taskType: 'GENERAL' });
        return response;
    }

    /**
     * Extract and define characters from the brief
     */
    private async extractCharacters(brief: string, narrative: string): Promise<CharacterDefinition[]> {
        const prompt = `Analyze this video brief and narrative to identify all characters needed:

Brief: "${brief}"

Narrative: "${narrative}"

For each character, provide:
1. Name (or role name like "Narrator", "Customer", "Expert")
2. Role: protagonist, narrator, supporting, or background
3. Physical description (detailed for AI image generation)
4. Style prompt suffix (comma-separated descriptors for consistent generation)
5. Voice description (for TTS)

If no human characters are needed, include at least a "Narrator" for voiceover.

Output as JSON array:
[
  {
    "name": "string",
    "role": "protagonist|narrator|supporting|background",
    "physicalDescription": "detailed description",
    "stylePromptSuffix": "age, gender, hair, eyes, clothing, etc",
    "voiceDescription": "warm, professional, male, etc"
  }
]`;

        const response = await backgroundLLM.generate(prompt, { taskType: 'GENERAL' });

        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return parsed.map((c: any, i: number) => ({
                    id: `char_${uuidv4().slice(0, 8)}`,
                    name: c.name || `Character_${i + 1}`,
                    role: c.role || 'supporting',
                    physicalDescription: c.physicalDescription || '',
                    stylePromptSuffix: c.stylePromptSuffix || '',
                    voiceDescription: c.voiceDescription
                }));
            }
        } catch (e) {
            console.warn('[StoryboardGenerator] Could not parse characters, using default');
        }

        // Default narrator
        return [{
            id: 'char_narrator',
            name: 'Narrator',
            role: 'narrator',
            physicalDescription: 'Professional voiceover artist',
            stylePromptSuffix: '',
            voiceDescription: 'warm, professional, clear enunciation'
        }];
    }

    /**
     * Generate visual style guide
     */
    private async generateStyleGuide(brief: string, platform: string): Promise<StyleGuide> {
        const prompt = `Create a visual style guide for a ${platform} video about:

"${brief}"

Provide:
1. Visual Style: Describe the overall look (cinematic, corporate, documentary, etc.)
2. Aspect Ratio: ${platform === 'reels' || platform === 'tiktok' ? '9:16' : '16:9'} (or recommend different)
3. Color Palette: 3-5 hex colors that match the brand/mood
4. Mood Keywords: 5-7 words describing the feel
5. Negative Prompt: What to avoid in visuals
6. Reference Style: A well-known style reference (optional)

Output as JSON:
{
  "visualStyle": "description",
  "aspectRatio": "16:9",
  "colorPalette": ["#hex1", "#hex2"],
  "moodKeywords": ["word1", "word2"],
  "negativePrompt": "things to avoid",
  "referenceStyle": "optional reference"
}`;

        const response = await backgroundLLM.generate(prompt, { taskType: 'GENERAL' });

        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    visualStyle: parsed.visualStyle || 'cinematic, professional',
                    aspectRatio: parsed.aspectRatio || '16:9',
                    colorPalette: parsed.colorPalette || ['#1a1a2e', '#16213e', '#0f3460'],
                    moodKeywords: parsed.moodKeywords || ['professional', 'modern'],
                    negativePrompt: parsed.negativePrompt || 'blurry, low quality, distorted',
                    referenceStyle: parsed.referenceStyle
                };
            }
        } catch (e) {
            console.warn('[StoryboardGenerator] Could not parse style guide, using defaults');
        }

        return {
            visualStyle: 'cinematic, professional, high production value',
            aspectRatio: platform === 'reels' || platform === 'tiktok' ? '9:16' : '16:9',
            colorPalette: ['#1a1a2e', '#16213e', '#0f3460', '#e94560'],
            moodKeywords: ['professional', 'modern', 'clean', 'engaging'],
            negativePrompt: 'blurry, low quality, distorted, amateur',
            referenceStyle: undefined
        };
    }

    /**
     * Generate detailed scenes with shots
     */
    private async generateScenes(
        narrative: string,
        characters: CharacterDefinition[],
        targetSeconds: number,
        platform: string
    ): Promise<Scene[]> {
        // Calculate scene breakdown
        const avgSceneLength = platform === 'reels' ? 10 : 30; // seconds
        const numScenes = Math.max(3, Math.ceil(targetSeconds / avgSceneLength));

        const prompt = `Break down this narrative into ${numScenes} distinct scenes for a ${Math.round(targetSeconds / 60)} minute video:

Narrative:
${narrative}

Characters Available:
${characters.map(c => `- ${c.name} (${c.role}): ${c.physicalDescription}`).join('\n')}

For each scene, provide:
1. Scene Number and Title
2. Purpose: intro, problem, solution, demo, story, climax, cta, or outro
3. Duration in seconds
4. Emotional Tone
5. 3-6 individual shots with:
   - Shot type (WIDE, MEDIUM, CLOSEUP, etc.)
   - Description of what we see
   - Subject description
   - Action (what's happening)
   - Camera movement (static, pan_left, zoom_in, etc.)
   - Transition (CUT, FADE, DISSOLVE)
   - Duration (2-8 seconds per shot)
   - Characters involved (by name)
   - Voiceover text for this moment

Output as JSON array of scenes.`;

        const response = await backgroundLLM.generate(prompt, { taskType: 'GENERAL' });

        try {
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return this.processScenes(parsed, characters);
            }
        } catch (e) {
            console.warn('[StoryboardGenerator] Could not parse scenes, generating basic structure');
        }

        // Fallback: generate basic scene structure
        return this.generateBasicScenes(targetSeconds, platform, characters);
    }

    /**
     * Process and validate parsed scenes
     */
    private processScenes(rawScenes: any[], characters: CharacterDefinition[]): Scene[] {
        return rawScenes.map((raw, i) => {
            const shots: Shot[] = (raw.shots || []).map((shot: any, j: number) => ({
                shotNumber: j + 1,
                type: this.normalizeType(shot.type || 'MEDIUM'),
                description: shot.description || '',
                subjectDescription: shot.subjectDescription || shot.subject || '',
                action: shot.action || '',
                cameraMovement: shot.cameraMovement || 'static',
                transition: shot.transition || 'CUT',
                duration: shot.duration || 4,
                characterIds: this.matchCharacterIds(shot.characters, characters),
                voiceoverSegment: shot.voiceoverSegment || shot.voiceover || '',
                imagePrompt: this.generateImagePrompt(shot, characters),
                videoPrompt: this.generateVideoPrompt(shot)
            }));

            return {
                sceneNumber: i + 1,
                title: raw.title || `Scene ${i + 1}`,
                description: raw.description || '',
                purpose: raw.purpose || 'story',
                duration: raw.duration || shots.reduce((acc, s) => acc + s.duration, 0),
                shots,
                audioRequirements: this.extractAudioRequirements(raw),
                emotionalTone: raw.emotionalTone || raw.tone || 'neutral'
            };
        });
    }

    /**
     * Generate basic scene structure as fallback
     */
    private generateBasicScenes(
        targetSeconds: number,
        platform: string,
        characters: CharacterDefinition[]
    ): Scene[] {
        const scenes: Scene[] = [];
        const purposes: Scene['purpose'][] = ['intro', 'problem', 'solution', 'demo', 'cta'];
        const durations = [0.1, 0.2, 0.4, 0.2, 0.1]; // Proportional durations

        purposes.forEach((purpose, i) => {
            const sceneDuration = Math.round(targetSeconds * durations[i]);
            const numShots = Math.max(2, Math.ceil(sceneDuration / 5));

            const shots: Shot[] = [];
            for (let j = 0; j < numShots; j++) {
                shots.push({
                    shotNumber: j + 1,
                    type: j === 0 ? 'WIDE' : 'MEDIUM',
                    description: `Shot ${j + 1} of ${purpose} scene`,
                    subjectDescription: 'Main subject',
                    action: 'Action for this shot',
                    cameraMovement: 'static',
                    transition: j === 0 ? 'FADE' : 'CUT',
                    duration: Math.round(sceneDuration / numShots),
                    voiceoverSegment: ''
                });
            }

            scenes.push({
                sceneNumber: i + 1,
                title: `${purpose.charAt(0).toUpperCase() + purpose.slice(1)} Scene`,
                description: `${purpose} content`,
                purpose,
                duration: sceneDuration,
                shots,
                audioRequirements: [
                    { type: 'voiceover', description: 'Narration for this scene' }
                ],
                emotionalTone: purpose === 'cta' ? 'urgent' : 'engaging'
            });
        });

        return scenes;
    }

    /**
     * Generate complete voiceover script
     */
    private async generateVoiceoverScript(scenes: Scene[]): Promise<string> {
        const voSegments: string[] = [];

        scenes.forEach(scene => {
            voSegments.push(`\n[SCENE ${scene.sceneNumber}: ${scene.title}]`);
            scene.shots.forEach(shot => {
                if (shot.voiceoverSegment) {
                    voSegments.push(shot.voiceoverSegment);
                }
            });
        });

        return voSegments.join('\n');
    }

    /**
     * Generate title for the video
     */
    private async generateTitle(brief: string): Promise<string> {
        const prompt = `Generate a short, catchy title (5-10 words) for a video about: "${brief}"
Output only the title, nothing else.`;

        const response = await backgroundLLM.generate(prompt, { taskType: 'GENERAL' });
        return response.trim().replace(/["']/g, '');
    }

    /**
     * Helper: Normalize shot type
     */
    private normalizeType(type: string): ShotType {
        const typeMap: Record<string, ShotType> = {
            'wide': 'WIDE',
            'medium': 'MEDIUM',
            'closeup': 'CLOSEUP',
            'close-up': 'CLOSEUP',
            'close up': 'CLOSEUP',
            'extreme closeup': 'EXTREME_CLOSEUP',
            'pov': 'POV',
            'tracking': 'TRACKING',
            'aerial': 'AERIAL',
            'establishing': 'ESTABLISHING',
            'talking head': 'TALKING_HEAD',
            'over shoulder': 'OVER_SHOULDER',
            'two shot': 'TWO_SHOT',
            'insert': 'INSERT'
        };
        return typeMap[type.toLowerCase()] || 'MEDIUM';
    }

    /**
     * Helper: Match character names to IDs
     */
    private matchCharacterIds(names: string[] | undefined, characters: CharacterDefinition[]): string[] {
        if (!names) return [];

        return names
            .map(name => {
                const char = characters.find(c =>
                    c.name.toLowerCase() === name.toLowerCase()
                );
                return char?.id;
            })
            .filter((id): id is string => !!id);
    }

    /**
     * Helper: Generate image prompt for a shot
     */
    private generateImagePrompt(shot: any, characters: CharacterDefinition[]): string {
        const charDescriptions = (shot.characterIds || [])
            .map((id: string) => {
                const char = characters.find(c => c.id === id);
                return char?.stylePromptSuffix;
            })
            .filter(Boolean)
            .join(', ');

        return `${shot.description || ''}, ${charDescriptions}, ${shot.type?.toLowerCase() || 'medium shot'}, cinematic lighting, high quality`.trim();
    }

    /**
     * Helper: Generate video prompt for a shot
     */
    private generateVideoPrompt(shot: any): string {
        const camera = shot.cameraMovement && shot.cameraMovement !== 'static'
            ? `camera ${shot.cameraMovement.replace('_', ' ')}`
            : '';

        return `${shot.action || 'subtle movement'}, ${camera}, smooth motion, cinematic`.trim();
    }

    /**
     * Helper: Extract audio requirements
     */
    private extractAudioRequirements(scene: any): AudioRequirement[] {
        const requirements: AudioRequirement[] = [
            { type: 'voiceover', description: 'Scene narration' }
        ];

        if (scene.emotionalTone === 'exciting' || scene.emotionalTone === 'urgent') {
            requirements.push({ type: 'music', description: 'Upbeat background music' });
        } else {
            requirements.push({ type: 'music', description: 'Ambient background music' });
        }

        return requirements;
    }

    /**
     * Expand a single scene with more detail
     */
    public async expandScene(scene: Scene, additionalContext: string): Promise<Scene> {
        const prompt = `Expand this video scene with more detailed shots:

Current Scene:
- Title: ${scene.title}
- Description: ${scene.description}
- Duration: ${scene.duration} seconds
- Current Shots: ${scene.shots.length}

Additional Context: ${additionalContext}

Add 2-3 more shots to enrich this scene. Maintain the emotional tone: ${scene.emotionalTone}

Output the new shots as JSON array.`;

        const response = await backgroundLLM.generate(prompt, { taskType: 'GENERAL' });

        try {
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const newShots = JSON.parse(jsonMatch[0]);
                const processedShots = newShots.map((shot: any, i: number) => ({
                    shotNumber: scene.shots.length + i + 1,
                    type: this.normalizeType(shot.type || 'MEDIUM'),
                    description: shot.description || '',
                    subjectDescription: shot.subjectDescription || '',
                    action: shot.action || '',
                    cameraMovement: shot.cameraMovement || 'static',
                    transition: shot.transition || 'CUT',
                    duration: shot.duration || 4,
                    voiceoverSegment: shot.voiceoverSegment || ''
                }));

                return {
                    ...scene,
                    shots: [...scene.shots, ...processedShots],
                    duration: scene.duration + processedShots.reduce((acc: number, s: Shot) => acc + s.duration, 0)
                };
            }
        } catch (e) {
            console.warn('[StoryboardGenerator] Could not expand scene');
        }

        return scene;
    }

    /**
     * Validate storyboard timing
     */
    public validateTiming(storyboard: Storyboard): {
        valid: boolean;
        actualDuration: number;
        difference: number;
        issues: string[];
    } {
        const issues: string[] = [];

        let actualDuration = 0;
        storyboard.scenes.forEach(scene => {
            const shotsDuration = scene.shots.reduce((acc, s) => acc + s.duration, 0);
            if (Math.abs(shotsDuration - scene.duration) > 2) {
                issues.push(`Scene ${scene.sceneNumber}: shots duration (${shotsDuration}s) doesn't match scene duration (${scene.duration}s)`);
            }
            actualDuration += shotsDuration;
        });

        const difference = actualDuration - storyboard.targetDuration;

        if (Math.abs(difference) > storyboard.targetDuration * 0.1) {
            issues.push(`Total duration (${actualDuration}s) differs from target (${storyboard.targetDuration}s) by more than 10%`);
        }

        return {
            valid: issues.length === 0,
            actualDuration,
            difference,
            issues
        };
    }
}

// Singleton export
export const storyboardGenerator = new StoryboardGenerator();
