// =============================================================================
// SILHOUETTE SKILLS SYSTEM
// Dynamic skill loader.
// Loads SKILL.md files from multiple locations with precedence.
// =============================================================================

import fs from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillDefinition {
    /** Unique skill name derived from directory name */
    name: string;
    /** Human-readable description */
    description: string;
    /** Full skill instructions (markdown body) */
    instructions: string;
    /** Where the skill was loaded from */
    source: 'bundled' | 'managed' | 'workspace';
    /** File path of the SKILL.md */
    filePath: string;
    /** Frontmatter metadata */
    metadata: {
        /** Whether users can invoke this skill directly */
        userInvocable?: boolean;
        /** How this skill is dispatched */
        commandDispatch?: 'tool' | 'prompt' | 'agent';
        /** Associated tool name if dispatch is 'tool' */
        commandTool?: string;
        /** Tags for categorization */
        tags?: string[];
        /** Required capabilities/tools */
        requires?: string[];
        /** Whether this skill is enabled */
        enabled?: boolean;
        /** Agent ID this skill belongs to */
        agentId?: string;
        /** Priority (higher = preferred when conflicts) */
        priority?: number;
    };
    /** When the skill was last modified */
    lastModified: number;
}

export interface SkillMatch {
    skill: SkillDefinition;
    relevance: number; // 0-1 relevance score
}

// ─── Skill Loader ────────────────────────────────────────────────────────────

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 * Simple parser that handles key: value pairs.
 */
function parseFrontmatter(content: string): { metadata: Record<string, any>; body: string } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) {
        return { metadata: {}, body: content };
    }

    const [, frontmatterRaw, body] = match;
    const metadata: Record<string, any> = {};

    for (const line of frontmatterRaw.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value: any = line.slice(colonIdx + 1).trim();

        // Type coercion
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^\d+$/.test(value)) value = parseInt(value, 10);
        else if (value.startsWith('[') && value.endsWith(']')) {
            // Simple array parsing: [a, b, c]
            value = value.slice(1, -1).split(',').map((s: string) => s.trim().replace(/['"]/g, ''));
        }

        metadata[key] = value;
    }

    return { metadata, body };
}

/**
 * Load a single skill from a directory containing SKILL.md
 */
function loadSkillFromDir(dirPath: string, source: SkillDefinition['source']): SkillDefinition | null {
    const skillMdPath = path.join(dirPath, 'SKILL.md');

    // Also support skill.md (lowercase) for compatibility
    const alternatives = ['SKILL.md', 'skill.md', 'README.md'];
    let actualPath: string | null = null;

    for (const alt of alternatives) {
        const p = path.join(dirPath, alt);
        if (fs.existsSync(p)) {
            actualPath = p;
            break;
        }
    }

    if (!actualPath) return null;

    try {
        const content = fs.readFileSync(actualPath, 'utf-8');
        const { metadata, body } = parseFrontmatter(content);
        const stats = fs.statSync(actualPath);
        const dirName = path.basename(dirPath);

        return {
            name: (metadata.name as string) ?? dirName,
            description: (metadata.description as string) ?? body.split('\n')[0]?.replace(/^#\s*/, '') ?? dirName,
            instructions: body,
            source,
            filePath: actualPath,
            metadata: {
                userInvocable: metadata['user-invocable'] ?? metadata['userInvocable'] ?? true,
                commandDispatch: metadata['command-dispatch'] ?? metadata['commandDispatch'] ?? 'prompt',
                commandTool: metadata['command-tool'] ?? metadata['commandTool'],
                tags: metadata.tags ?? [],
                requires: metadata.requires ?? [],
                enabled: metadata.enabled !== false,
                agentId: metadata['agent-id'] ?? metadata['agentId'],
                priority: metadata.priority ?? 0,
            },
            lastModified: stats.mtimeMs,
        };
    } catch (err) {
        console.error(`[SkillLoader] Failed to load skill from ${dirPath}:`, err);
        return null;
    }
}

/**
 * Scan a directory for skill subdirectories.
 * Each subdirectory containing a SKILL.md is treated as a skill.
 */
function scanSkillDirectory(basePath: string, source: SkillDefinition['source']): SkillDefinition[] {
    if (!fs.existsSync(basePath)) return [];

    const skills: SkillDefinition[] = [];

    try {
        const entries = fs.readdirSync(basePath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skill = loadSkillFromDir(path.join(basePath, entry.name), source);
            if (skill) {
                skills.push(skill);
            }
        }
    } catch (err) {
        console.error(`[SkillLoader] Failed to scan ${basePath}:`, err);
    }

    return skills;
}

// ─── Skill Registry ──────────────────────────────────────────────────────────

class SkillRegistry {
    private skills: Map<string, SkillDefinition> = new Map();
    private searchIndex: Map<string, Set<string>> = new Map(); // tag → skill names

    /**
     * Load skills from all configured locations with precedence:
     * 1. Workspace skills (highest priority)
     * 2. Managed/user skills
     * 3. Bundled skills (from universalprompts)
     */
    loadAll(projectRoot?: string): void {
        const root = projectRoot ?? process.cwd();
        const before = this.skills.size;

        // Source 1: Bundled — universalprompts (lowest precedence)
        const bundledPath = path.join(root, 'universalprompts');
        const bundled = scanSkillDirectory(bundledPath, 'bundled');

        // Source 2: Managed — user-installed skills
        const managedPath = path.join(root, 'skills');
        const managed = scanSkillDirectory(managedPath, 'managed');

        // Source 3: Workspace — project-specific skills (highest precedence)
        const workspacePath = path.join(root, '.silhouette', 'skills');
        const workspace = scanSkillDirectory(workspacePath, 'workspace');

        // Register with precedence (last write wins)
        for (const skill of [...bundled, ...managed, ...workspace]) {
            if (skill.metadata.enabled !== false) {
                this.register(skill);
            }
        }

        console.log(`[SkillRegistry] 📚 Loaded ${this.skills.size} skills (${bundled.length} bundled, ${managed.length} managed, ${workspace.length} workspace)`);
    }

    /**
     * Register or update a skill.
     */
    register(skill: SkillDefinition): void {
        const existing = this.skills.get(skill.name);

        // Higher priority wins, workspace > managed > bundled
        const sourcePriority: Record<string, number> = { bundled: 0, managed: 1, workspace: 2 };
        if (existing) {
            const existingPriority = sourcePriority[existing.source] ?? 0;
            const newPriority = sourcePriority[skill.source] ?? 0;
            if (newPriority < existingPriority) return; // Don't override higher-precedence
        }

        this.skills.set(skill.name, skill);

        // Update search index
        const tags = skill.metadata.tags ?? [];
        for (const tag of tags) {
            if (!this.searchIndex.has(tag)) this.searchIndex.set(tag, new Set());
            this.searchIndex.get(tag)!.add(skill.name);
        }
    }

    /**
     * Get a skill by name.
     */
    get(name: string): SkillDefinition | undefined {
        return this.skills.get(name);
    }

    /**
     * List all loaded skills.
     */
    list(filter?: {
        source?: SkillDefinition['source'];
        tag?: string;
        agentId?: string;
        userInvocable?: boolean;
    }): SkillDefinition[] {
        let results = Array.from(this.skills.values());

        if (filter?.source) {
            results = results.filter(s => s.source === filter.source);
        }
        if (filter?.tag) {
            const names = this.searchIndex.get(filter.tag);
            if (names) {
                results = results.filter(s => names.has(s.name));
            } else {
                results = [];
            }
        }
        if (filter?.agentId) {
            results = results.filter(s => !s.metadata.agentId || s.metadata.agentId === filter.agentId);
        }
        if (filter?.userInvocable !== undefined) {
            results = results.filter(s => s.metadata.userInvocable === filter.userInvocable);
        }

        return results.sort((a, b) => (b.metadata.priority ?? 0) - (a.metadata.priority ?? 0));
    }

    /**
     * Search skills by query (name, description, tags).
     */
    search(query: string): SkillMatch[] {
        const q = query.toLowerCase();
        const results: SkillMatch[] = [];

        for (const skill of this.skills.values()) {
            let relevance = 0;

            // Name match (highest weight)
            if (skill.name.toLowerCase().includes(q)) relevance += 0.5;
            // Description match
            if (skill.description.toLowerCase().includes(q)) relevance += 0.3;
            // Tag match
            if (skill.metadata.tags?.some(t => t.toLowerCase().includes(q))) relevance += 0.2;

            if (relevance > 0) {
                results.push({ skill, relevance });
            }
        }

        return results.sort((a, b) => b.relevance - a.relevance);
    }

    /**
     * Get skills that match given agent capabilities.
     */
    getForAgent(agentId: string, capabilities?: string[]): SkillDefinition[] {
        return this.list().filter(skill => {
            // Agent-specific skill
            if (skill.metadata.agentId && skill.metadata.agentId !== agentId) return false;

            // Check required capabilities
            if (skill.metadata.requires && skill.metadata.requires.length > 0) {
                if (!capabilities) return false;
                return skill.metadata.requires.every(req => capabilities.includes(req));
            }

            return true;
        });
    }

    /**
     * Get the instructions for a skill, formatted for LLM context injection.
     */
    getInstructions(skillName: string): string | null {
        const skill = this.skills.get(skillName);
        if (!skill) return null;
        return `[Skill: ${skill.name}]\n${skill.description}\n\n${skill.instructions}`;
    }

    /**
     * Stats about loaded skills.
     */
    getStats() {
        const all = Array.from(this.skills.values());
        return {
            total: all.length,
            bundled: all.filter(s => s.source === 'bundled').length,
            managed: all.filter(s => s.source === 'managed').length,
            workspace: all.filter(s => s.source === 'workspace').length,
            tags: Array.from(this.searchIndex.keys()),
        };
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const skillRegistry = new SkillRegistry();
