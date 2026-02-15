import { Agent } from '../types';
import { sqliteService } from './sqliteService';

export class AgentPersistence {

    public saveAgent(agent: Agent): void {
        try {
            sqliteService.upsertAgent(agent);
        } catch (error) {
            console.error(`[PERSISTENCE] Failed to save agent ${agent.id}`, error);
        }
    }

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
        } catch (error) {
            console.error(`[PERSISTENCE] Failed to delete agent ${agentId}`, error);
        }
    }
}

export const agentPersistence = new AgentPersistence();
