import fs from 'fs/promises';
import path from 'path';
import { AgentProfile } from '../../types';

const AGENTS_DIR = path.join(process.cwd(), 'data', 'agents', 'definitions');

export class AgentRegistry {
    private cache: Map<string, AgentProfile> = new Map();

    /**
     * Loads all agent definitions from the data/agents/definitions directory.
     */
    async loadAgents(): Promise<void> {
        try {
            await fs.mkdir(AGENTS_DIR, { recursive: true });
            const files = await fs.readdir(AGENTS_DIR);

            this.cache.clear();

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = await fs.readFile(path.join(AGENTS_DIR, file), 'utf-8');
                    try {
                        const agent = JSON.parse(content) as AgentProfile;
                        if (agent.id) {
                            this.cache.set(agent.id, agent);
                        }
                    } catch (parseError) {
                        console.error(`[AgentRegistry] Failed to parse agent definition: ${file}`, parseError);
                    }
                }
            }

            console.log(`[AgentRegistry] Loaded ${this.cache.size} agents from disk.`);
        } catch (error) {
            console.error('[AgentRegistry] Failed to load agents:', error);
            throw error;
        }
    }

    /**
     * Retrieves an agent by ID.
     * @param id The ID of the agent to retrieve.
     */
    getAgent(id: string): AgentProfile | undefined {
        return this.cache.get(id);
    }

    /**
     * Retrieves all registered agents.
     */
    getAllAgents(): AgentProfile[] {
        return Array.from(this.cache.values());
    }

    /**
     * Saves or updates an agent definition.
     * @param agent The agent profile to save.
     */
    async saveAgent(agent: AgentProfile): Promise<void> {
        if (!agent.id) {
            throw new Error("Cannot save agent without an ID");
        }

        try {
            await fs.mkdir(AGENTS_DIR, { recursive: true });
            const filePath = path.join(AGENTS_DIR, `${agent.id}.json`);
            await fs.writeFile(filePath, JSON.stringify(agent, null, 2), 'utf-8');

            this.cache.set(agent.id, agent);
            console.log(`[AgentRegistry] Saved agent: ${agent.id}`);
        } catch (error) {
            console.error(`[AgentRegistry] Failed to save agent ${agent.id}:`, error);
            throw error;
        }
    }
}

export const agentRegistry = new AgentRegistry();
