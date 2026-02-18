/**
 * AGENT FILE SYSTEM SERVICE
 * 
 * Manages the per-agent file system that gives each agent a rich identity.
 * Each agent gets a directory under `data/agents/{agent-id}/` with 8 markdown files:
 * 
 * - IDENTITY.md  → Display name, avatar, role, team, greeting
 * - SOUL.md      → Personality, values, communication style, principles
 * - AGENTS.md    → Operational rules, permissions, boundaries, limits
 * - TOOLS.md     → Available tools, usage instructions, conventions
 * - USER.md      → Info about the human operator/user
 * - HEARTBEAT.md → Proactive scheduled tasks (checklist for heartbeat cycles)
 * - BOOTSTRAP.md → Startup instructions, dependencies, initialization order
 * - MEMORY.md    → Accumulated memories, session summaries, learned facts
 */

import fs from 'fs';
import path from 'path';
import { Agent, AgentRoleType, AgentTier, AgentCapability } from '../../types';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const AGENTS_BASE_DIR = path.resolve(process.cwd(), 'data', 'agents');

/** The 8 standard files every agent has */
export const AGENT_FILES = [
    'IDENTITY.md',
    'SOUL.md',
    'AGENTS.md',
    'TOOLS.md',
    'USER.md',
    'HEARTBEAT.md',
    'BOOTSTRAP.md',
    'MEMORY.md'
] as const;

export type AgentFileName = typeof AGENT_FILES[number];

// ═══════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════

/** The full context loaded from an agent's file system */
export interface AgentContext {
    identity: string;
    soul: string;
    rules: string;
    tools: string;
    user: string;
    heartbeat: string;
    bootstrap: string;
    memory: string;
}

/** Options for generating the system prompt from agent files */
export interface PromptOptions {
    includeMemory?: boolean;    // Default: true
    includeHeartbeat?: boolean; // Default: false (only on heartbeat ticks)
    includeUser?: boolean;      // Default: true when user-facing
    maxMemoryLines?: number;    // Default: 100 (most recent)
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class AgentFileSystem {

    /**
     * Returns the directory path for a specific agent.
     */
    public getAgentDir(agentId: string): string {
        return path.join(AGENTS_BASE_DIR, agentId);
    }

    /**
     * Returns the path to a specific file for a specific agent.
     */
    public getFilePath(agentId: string, fileName: AgentFileName): string {
        return path.join(this.getAgentDir(agentId), fileName);
    }

    /**
     * Check if an agent's directory and files exist.
     */
    public agentDirExists(agentId: string): boolean {
        return fs.existsSync(this.getAgentDir(agentId));
    }

    // ───────────────────────────────────────────────────────────
    // LOAD
    // ───────────────────────────────────────────────────────────

    /**
     * Load all 8 files for an agent, returning them as an AgentContext.
     * If a file doesn't exist, returns empty string for that field.
     */
    public loadAgentContext(agentId: string): AgentContext {
        const dir = this.getAgentDir(agentId);
        if (!fs.existsSync(dir)) {
            console.warn(`[AGENT_FS] No directory for agent: ${agentId}`);
            return this.emptyContext();
        }

        return {
            identity: this.readFile(agentId, 'IDENTITY.md'),
            soul: this.readFile(agentId, 'SOUL.md'),
            rules: this.readFile(agentId, 'AGENTS.md'),
            tools: this.readFile(agentId, 'TOOLS.md'),
            user: this.readFile(agentId, 'USER.md'),
            heartbeat: this.readFile(agentId, 'HEARTBEAT.md'),
            bootstrap: this.readFile(agentId, 'BOOTSTRAP.md'),
            memory: this.readFile(agentId, 'MEMORY.md'),
        };
    }

    /**
     * Read a single file for an agent.
     */
    public readFile(agentId: string, fileName: AgentFileName): string {
        const filePath = this.getFilePath(agentId, fileName);
        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf-8');
            }
        } catch (error) {
            console.error(`[AGENT_FS] Failed to read ${fileName} for ${agentId}:`, error);
        }
        return '';
    }

    /**
     * Build a rich system prompt from the agent's files.
     * This is the main injection point for giving agents their identity.
     */
    public buildSystemPrompt(agentId: string, options: PromptOptions = {}): string {
        const ctx = this.loadAgentContext(agentId);
        const {
            includeMemory = true,
            includeHeartbeat = false,
            includeUser = true,
            maxMemoryLines = 100
        } = options;

        const sections: string[] = [];

        // Always include core identity
        if (ctx.identity) {
            sections.push(`--- IDENTITY ---\n${ctx.identity}`);
        }

        if (ctx.soul) {
            sections.push(`--- SOUL (Who You Are) ---\n${ctx.soul}`);
        }

        if (ctx.rules) {
            sections.push(`--- OPERATIONAL RULES ---\n${ctx.rules}`);
        }

        if (ctx.tools) {
            sections.push(`--- TOOLS & CAPABILITIES ---\n${ctx.tools}`);
        }

        if (ctx.bootstrap) {
            sections.push(`--- BOOTSTRAP INSTRUCTIONS ---\n${ctx.bootstrap}`);
        }

        if (includeUser && ctx.user) {
            sections.push(`--- USER CONTEXT ---\n${ctx.user}`);
        }

        if (includeHeartbeat && ctx.heartbeat) {
            sections.push(`--- HEARTBEAT CHECKLIST ---\n${ctx.heartbeat}`);
        }

        if (includeMemory && ctx.memory) {
            // Trim memory to most recent lines to avoid overloading context
            const memoryLines = ctx.memory.split('\n');
            const trimmed = memoryLines.length > maxMemoryLines
                ? memoryLines.slice(-maxMemoryLines).join('\n')
                : ctx.memory;
            sections.push(`--- MEMORY (Recent) ---\n${trimmed}`);
        }

        return sections.join('\n\n');
    }

    // ───────────────────────────────────────────────────────────
    // SAVE / UPDATE
    // ───────────────────────────────────────────────────────────

    /**
     * Write a specific file for an agent.
     */
    public writeFile(agentId: string, fileName: AgentFileName, content: string): void {
        const dir = this.getAgentDir(agentId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const filePath = this.getFilePath(agentId, fileName);
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
        } catch (error) {
            console.error(`[AGENT_FS] Failed to write ${fileName} for ${agentId}:`, error);
        }
    }

    /**
     * Append content to an agent's MEMORY.md (append-only log).
     */
    public appendMemory(agentId: string, entry: string): void {
        const filePath = this.getFilePath(agentId, 'MEMORY.md');
        const dir = this.getAgentDir(agentId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const timestamp = new Date().toISOString();
        const formattedEntry = `\n## [${timestamp}]\n${entry}\n`;

        try {
            fs.appendFileSync(filePath, formattedEntry, 'utf-8');
        } catch (error) {
            console.error(`[AGENT_FS] Failed to append memory for ${agentId}:`, error);
        }
    }

    /**
     * Update the SOUL.md for an agent (evolution of personality).
     */
    public updateSoul(agentId: string, newSoulContent: string): void {
        this.writeFile(agentId, 'SOUL.md', newSoulContent);
        console.log(`[AGENT_FS] 🧬 Soul evolved for agent: ${agentId}`);
    }

    /**
     * Personalize an agent's identity and soul (User Onboarding).
     * Updates display name, greeting, and personality traits.
     */
    public personalizeAgent(agentId: string, name: string, personality: string, greeting: string, style: string): void {
        // 1. Update IDENTITY.md
        const currentIdentity = this.readFile(agentId, 'IDENTITY.md');
        const newIdentity = currentIdentity
            .replace(/## Display Name\n.*/, `## Display Name\n${name}`)
            .replace(/## Greeting\n[\s\S]*?(?=\n## Avatar)/, `## Greeting\n${greeting}`);

        this.writeFile(agentId, 'IDENTITY.md', newIdentity);

        // 2. Update SOUL.md
        const currentSoul = this.readFile(agentId, 'SOUL.md');
        const newSoul = currentSoul
            .replace(/## Personality\n.*/, `## Personality\n${personality}`)
            .replace(/## Communication Style\n[\s\S]*?(?=\n## Principles)/, `## Communication Style\n${style}`);

        this.writeFile(agentId, 'SOUL.md', newSoul);

        console.log(`[AGENT_FS] ✨ Agent ${agentId} personalized as: ${name}`);
    }

    /**
     * Get the heartbeat checklist items for an agent.
     * Returns parsed checklist items from HEARTBEAT.md.
     */
    public getHeartbeatChecklist(agentId: string): HeartbeatItem[] {
        const content = this.readFile(agentId, 'HEARTBEAT.md');
        if (!content) return [];

        const items: HeartbeatItem[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const match = line.match(/^- \[([ x])\] (.+)$/);
            if (match) {
                items.push({
                    completed: match[1] === 'x',
                    task: match[2].trim()
                });
            }
        }

        return items;
    }

    // ───────────────────────────────────────────────────────────
    // CREATION (Templates)
    // ───────────────────────────────────────────────────────────

    /**
     * Create the full directory structure for a new agent with all 8 template files.
     */
    public createAgentDirectory(agent: Agent): void {
        const dir = this.getAgentDir(agent.id);

        if (fs.existsSync(dir)) {
            console.log(`[AGENT_FS] Directory already exists for: ${agent.id}`);
            return;
        }

        fs.mkdirSync(dir, { recursive: true });

        // Generate and write all 8 files from templates
        this.writeFile(agent.id, 'IDENTITY.md', generateIdentityTemplate(agent));
        this.writeFile(agent.id, 'SOUL.md', generateSoulTemplate(agent));
        this.writeFile(agent.id, 'AGENTS.md', generateAgentsTemplate(agent));
        this.writeFile(agent.id, 'TOOLS.md', generateToolsTemplate(agent));
        this.writeFile(agent.id, 'USER.md', generateUserTemplate());
        this.writeFile(agent.id, 'HEARTBEAT.md', generateHeartbeatTemplate(agent));
        this.writeFile(agent.id, 'BOOTSTRAP.md', generateBootstrapTemplate(agent));
        this.writeFile(agent.id, 'MEMORY.md', generateMemoryTemplate(agent));

        console.log(`[AGENT_FS] ✅ Created full directory for agent: ${agent.id} (${agent.name})`);
    }

    /**
     * Migrate an existing agent (already in SQLite) to the file system.
     * Creates the directory and files without overwriting the SQLite data.
     */
    public migrateExistingAgent(agent: Agent): void {
        if (this.agentDirExists(agent.id)) {
            return; // Already migrated
        }
        this.createAgentDirectory(agent);
        console.log(`[AGENT_FS] 🔄 Migrated existing agent to file system: ${agent.id}`);
    }

    /**
     * Delete an agent's directory (use with caution).
     */
    public deleteAgentDirectory(agentId: string): void {
        const dir = this.getAgentDir(agentId);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`[AGENT_FS] 🗑️ Deleted directory for agent: ${agentId}`);
        }
    }

    /**
     * List all agent IDs that have directories on the file system.
     */
    public listAgentDirectories(): string[] {
        if (!fs.existsSync(AGENTS_BASE_DIR)) {
            return [];
        }
        return fs.readdirSync(AGENTS_BASE_DIR)
            .filter(f => {
                const stat = fs.statSync(path.join(AGENTS_BASE_DIR, f));
                return stat.isDirectory() && f !== 'definitions'; // Exclude legacy folder
            });
    }

    private emptyContext(): AgentContext {
        return {
            identity: '', soul: '', rules: '', tools: '',
            user: '', heartbeat: '', bootstrap: '', memory: ''
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// HEARTBEAT ITEM TYPE
// ═══════════════════════════════════════════════════════════════

export interface HeartbeatItem {
    completed: boolean;
    task: string;
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE GENERATORS
// ═══════════════════════════════════════════════════════════════

function getRoleName(roleType: AgentRoleType): string {
    switch (roleType) {
        case AgentRoleType.LEADER: return 'Team Leader';
        case AgentRoleType.WORKER: return 'Specialist Worker';
        default: return 'Agent';
    }
}

function getTierLabel(tier: AgentTier): string {
    switch (tier) {
        case AgentTier.CORE: return 'Core (Always Active)';
        case AgentTier.SPECIALIST: return 'Specialist (On-Demand)';
        case AgentTier.WORKER: return 'Worker (Task-Specific)';
        default: return 'Standard';
    }
}

function generateIdentityTemplate(agent: Agent): string {
    return `# Identity: ${agent.name}

## Display Name
${agent.name.replace(/_/g, ' ')}

## Role
${agent.role}

## Role Type
${getRoleName(agent.roleType)}

## Tier
${getTierLabel(agent.tier)}

## Team
${agent.teamId}

## Category
${agent.category}

## Greeting
Hello, I am ${agent.name.replace(/_/g, ' ')}. I serve as ${agent.role} within the ${agent.teamId} squad.

## Avatar
🤖
`;
}

function generateSoulTemplate(agent: Agent): string {
    const coreDirectives = agent.directives?.length
        ? agent.directives.map(d => `- ${d}`).join('\n')
        : '- Execute tasks with precision and reliability\n- Communicate clearly and concisely\n- Collaborate with other agents when needed';

    const opinion = agent.opinion || 'I approach problems systematically and aim for robust solutions.';

    return `# Soul: ${agent.name}

## Personality
I am ${agent.name.replace(/_/g, ' ')}, a ${agent.role} within the Silhouette Agency OS.

## Core Values
- Excellence in my domain of expertise
- Transparency in my reasoning process
- Collaboration over isolation
- Continuous self-improvement

## Communication Style
- Professional but approachable
- Clear and structured responses
- I explain my reasoning when making decisions
- I ask for clarification when instructions are ambiguous

## Principles
${coreDirectives}

## Worldview
${opinion}

## Tool Usage Philosophy
- I use tools deliberately, not reflexively
- I verify tool outputs before reporting results
- I prefer the simplest tool that accomplishes the task
- I report tool failures honestly

## Memory Philosophy
- I summarize key outcomes after completing tasks
- I note patterns and improvements for future reference
- I discard irrelevant noise to keep my memory focused
`;
}

function generateAgentsTemplate(agent: Agent): string {
    const isLeader = agent.roleType === AgentRoleType.LEADER;
    const isCore = agent.tier === AgentTier.CORE;

    return `# Operational Rules: ${agent.name}

## Permissions
${isCore ? '- FULL SYSTEM ACCESS: Can interact with all protocols and agents' : ''}
${isLeader ? '- DELEGATION: Can assign tasks to workers in my squad' : ''}
${isLeader ? '- CROSS-SQUAD: Can request help from other squad leaders' : ''}
- MEMORY_WRITE: Can persist memories and learned facts
- TOOL_EXECUTE: Can use tools listed in TOOLS.md
- REPORT: Can submit status reports to my squad leader

## Restrictions
- NEVER modify system configuration without Orchestrator approval
- NEVER exceed allocated resource budget
- NEVER delete other agents' memory or files
- ALWAYS respect the hierarchy of command
${!isLeader ? '- CANNOT directly delegate to agents outside my squad' : ''}
${!isCore ? '- CANNOT modify core system protocols' : ''}

## Communication Rules
- When receiving a DELEGATION: acknowledge and execute
- When receiving a HELP_REQUEST: respond truthfully about capability
- When stuck: escalate to squad leader (or Orchestrator if I am a leader)
- When completing a task: send REPORT to the requesting agent

## Error Handling
- On tool failure: retry once, then report failure with details
- On timeout: log the issue and notify squad leader
- On data corruption: escalate immediately to Orchestrator
`;
}

function generateToolsTemplate(agent: Agent): string {
    const capabilities = agent.capabilities || [];
    const toolLines = capabilities.length > 0
        ? capabilities.map(c => `- ${c}`).join('\n')
        : '- No specific tools assigned yet. Tools will be dynamically registered.';

    return `# Tools: ${agent.name}

## Available Capabilities
${toolLines}

## Tool Usage Conventions
1. Always validate inputs before calling a tool
2. Handle errors gracefully — never crash on tool failure
3. Log significant tool usage for observability
4. If a tool is unavailable, report it rather than attempting workarounds

## Custom Instructions
- Use web_search for factual queries that require up-to-date information
- Use memory_write to persist important discoveries
- Use memory_read to check existing knowledge before searching externally
`;
}

function generateUserTemplate(): string {
    return `# User Context

## Who Is The User?
The user is the operator of Silhouette Agency OS. 

## Preferences
- Language: Spanish (primary), English (technical)
- Communication: Direct, detailed, action-oriented
- Solutions: Robust and scalable, never temporary patches
- Architecture: Long-term thinking, modular design

## Important Notes
- The user values transparency and honesty about limitations
- The user prefers proactive communication about issues
- The user appreciates when agents explain their reasoning
`;
}

function generateHeartbeatTemplate(agent: Agent): string {
    const isLeader = agent.roleType === AgentRoleType.LEADER;

    return `# Heartbeat Checklist: ${agent.name}

## On Every Heartbeat
- [ ] Check inbox for pending messages
- [ ] Review active tasks status
${isLeader ? '- [ ] Check squad member status' : ''}
${isLeader ? '- [ ] Review pending delegations' : ''}

## Periodic (Every 10 Heartbeats)
- [ ] Summarize recent activity to MEMORY.md
- [ ] Check for stale tasks (>30 min without progress)

## On Idle
- [ ] Review MEMORY.md for patterns or improvements
- [ ] Self-assess performance and update SOUL.md if needed
`;
}

function generateBootstrapTemplate(agent: Agent): string {
    return `# Bootstrap: ${agent.name}

## Startup Sequence
1. Load IDENTITY.md → Establish who I am
2. Load SOUL.md → Establish my personality and values
3. Load AGENTS.md → Understand my rules and permissions
4. Load TOOLS.md → Register available capabilities
5. Load USER.md → Understand who I serve
6. Load MEMORY.md → Restore context from previous sessions
7. Announce readiness to Orchestrator via SystemBus

## Dependencies
- SystemBus must be initialized
- SQLite must be accessible
- LLM provider must be configured

## Health Check
- Verify I can access my file system directory
- Verify I can read/write to MEMORY.md
- Verify I can communicate via SystemBus

## Tier: ${getTierLabel(agent.tier)}
${agent.tier === AgentTier.CORE ? '- I am a CORE agent: I should be ready at all times' : ''}
${agent.tier === AgentTier.SPECIALIST ? '- I am a SPECIALIST: I am hydrated on-demand when my expertise is needed' : ''}
${agent.tier === AgentTier.WORKER ? '- I am a WORKER: I am spawned for specific tasks and may be dehydrated after' : ''}
`;
}

function generateMemoryTemplate(agent: Agent): string {
    const timestamp = new Date().toISOString();
    return `# Memory Log: ${agent.name}

> This file is an append-only log of significant memories, decisions, and learnings.
> Newer entries appear at the bottom.

## [${timestamp}]
Agent initialized as ${agent.role} in ${agent.teamId}. Ready for operations.
`;
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const agentFileSystem = new AgentFileSystem();
