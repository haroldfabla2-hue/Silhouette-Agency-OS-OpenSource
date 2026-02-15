/**
 * SKILL FACTORY - Programmatic Skill Generation
 * 
 * Enables Silhouette to:
 * 1. Create new skills from natural language descriptions
 * 2. Validate skill structure
 * 3. Persist skills to the workspace
 */

import fs from 'fs';
import path from 'path';
import { skillRegistry, SkillDefinition } from './skillRegistry';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export interface SkillCreationRequest {
    name: string;
    description: string;
    instructions: string;
    metadata?: SkillDefinition['metadata'];
}

class SkillFactory {
    private static instance: SkillFactory;
    private workspaceSkillsPath: string;

    private constructor() {
        this.workspaceSkillsPath = path.join(process.cwd(), '.silhouette', 'skills');
    }

    public static getInstance(): SkillFactory {
        if (!SkillFactory.instance) {
            SkillFactory.instance = new SkillFactory();
        }
        return SkillFactory.instance;
    }

    /**
     * Create and save a new skill
     */
    public async createSkill(request: SkillCreationRequest): Promise<SkillDefinition> {
        console.log(`[SkillFactory] 🧠 Creating skill: ${request.name}`);

        // 1. Validate request
        this.validateRequest(request);

        // 2. Prepare file content
        const fileContent = this.generateSkillFileContent(request);
        const skillDir = path.join(this.workspaceSkillsPath, request.name);
        const filePath = path.join(skillDir, 'SKILL.md');

        // 3. Ensure directory exists
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        // 4. Write file
        fs.writeFileSync(filePath, fileContent, 'utf-8');

        // 5. Load and register
        // We manually construct the definition to return it immediately, 
        // but we also trigger a reload in the registry if needed.
        const skill: SkillDefinition = {
            name: request.name,
            description: request.description,
            instructions: request.instructions,
            source: 'workspace',
            filePath,
            metadata: {
                userInvocable: true,
                commandDispatch: 'prompt',
                ...request.metadata
            },
            lastModified: Date.now()
        };

        skillRegistry.register(skill);

        // 6. Emit event
        systemBus.emit(SystemProtocol.UI_REFRESH, {
            source: 'SKILL_FACTORY',
            message: `New skill created: ${skill.name}`,
            skill: skill.name
        });

        console.log(`[SkillFactory] ✅ Skill saved to: ${filePath}`);
        return skill;
    }

    private validateRequest(request: SkillCreationRequest): void {
        if (!request.name || !/^[a-z0-9_-]+$/i.test(request.name)) {
            throw new Error('Invalid skill name. Use alphanumeric, hyphens, or underscores.');
        }
        if (!request.instructions) {
            throw new Error('Skill instructions are required.');
        }
    }

    private generateSkillFileContent(request: SkillCreationRequest): string {
        const metadataLines = [
            '---',
            `name: ${request.name}`,
            `description: ${request.description}`,
            `user-invocable: ${request.metadata?.userInvocable ?? true}`,
            `command-dispatch: ${request.metadata?.commandDispatch ?? 'prompt'}`,
        ];

        if (request.metadata?.tags && request.metadata.tags.length > 0) {
            metadataLines.push(`tags: [${request.metadata.tags.join(', ')}]`);
        }

        if (request.metadata?.requires && request.metadata.requires.length > 0) {
            metadataLines.push(`requires: [${request.metadata.requires.join(', ')}]`);
        }

        metadataLines.push('---');
        metadataLines.push('');
        metadataLines.push(request.instructions);

        return metadataLines.join('\n');
    }
}

export const skillFactory = SkillFactory.getInstance();
