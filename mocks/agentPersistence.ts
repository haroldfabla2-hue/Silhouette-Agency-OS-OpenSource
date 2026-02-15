import { Agent } from '../types';

const memoryStore = new Map<string, Agent>();

export const agentPersistence = {
    saveAgent: (agent: Agent) => {
        memoryStore.set(agent.id, agent);
    },
    loadAgent: (id: string): Agent | null => {
        return memoryStore.get(id) || null;
    },
    getAllAgentIds: (): string[] => {
        return Array.from(memoryStore.keys());
    },
    deleteAgent: (agentId: string) => {
        memoryStore.delete(agentId);
    }
};
