import { Agent } from '../types';
import { sqliteService } from './sqliteService';
import { agentFileSystem } from './agents/agentFileSystem';

export class AgentPersistence {

    /**
     * Save agent to SQLite AND ensure its file system directory exists.
     * On first save, creates the per-agent directory with 8 template files.
     */
    public saveAgent(agent: Agent): void {
        try {
            sqliteService.upsertAgent(agent);

            // Ensure per-agent file system directory exists
            if (!agentFileSystem.agentDirExists(agent.id)) {
                agentFileSystem.createAgentDirectory(agent);
            }
        } catch (error) {
            console.error(`[PERSISTENCE] Failed to save agent ${agent.id}`, error);
        }
    }

    /**
     * Load agent from SQLite.
     * The file-system context (SOUL, IDENTITY, etc.) is loaded separately
     * via agentFileSystem.buildSystemPrompt() when the agent is hydrated.
     */
    public loadAgent(agentId: string): Agent | null {
        try {
            return sqliteService.getAgent(agentId);
        } catch (error) {
            console.error(`[PERSISTENCE] Failed to load agent ${agentId}`, error);
            return null;
        }
    }

    public getAllAgentIds(): string[] {
        try {
            const agents = sqliteService.getAllAgents();
            return agents.map(a => a.id);
        } catch (error) {
            console.error("[PERSISTENCE] Failed to list agents", error);
            return [];
        }
    }

    public saveAgents(agents: Agent[]): void {
        agents.forEach(agent => {
            this.saveAgent(agent);
        });
    }

    public deleteAgent(agentId: string): void {
        try {
            sqliteService.deleteAgent(agentId);
            // Optionally delete file system directory too
            // agentFileSystem.deleteAgentDirectory(agentId);
            // ^ Not deleting by default to preserve memory/history
        } catch (error) {
            console.error(`[PERSISTENCE] Failed to delete agent ${agentId}`, error);
        }
    }

    /**
     * Migrate ALL existing agents to the per-agent file system.
     * Creates directories and template files for agents that don't have them yet.
     * Safe to call multiple times (idempotent).
     */
    public migrateAllToFileSystem(): number {
        let migrated = 0;
        try {
            const allAgents = sqliteService.getAllAgents();
            for (const agent of allAgents) {
                if (!agentFileSystem.agentDirExists(agent.id)) {
                    agentFileSystem.createAgentDirectory(agent);
                    migrated++;
                }
            }
            if (migrated > 0) {
                console.log(`[PERSISTENCE] 🔄 Migrated ${migrated} agents to per-agent file system.`);
            }
        } catch (error) {
            console.error("[PERSISTENCE] Migration to file system failed:", error);
        }
        return migrated;
    }
}

export const agentPersistence = new AgentPersistence();
