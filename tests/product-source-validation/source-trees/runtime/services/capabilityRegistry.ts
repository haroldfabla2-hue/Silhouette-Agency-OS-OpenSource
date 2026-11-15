import { AgentCapability, Agent } from '../types';

interface CapabilityProvider {
    agentId: string;
    score: number; // For future QoS routing
}

export class CapabilityRegistry {
    private static instance: CapabilityRegistry;

    // Map: Capability -> List of Providers
    private registry: Map<AgentCapability, CapabilityProvider[]> = new Map();

    private constructor() { }

    public static getInstance(): CapabilityRegistry {
        if (!CapabilityRegistry.instance) {
            CapabilityRegistry.instance = new CapabilityRegistry();
        }
        return CapabilityRegistry.instance;
    }

    /**
     * Registers an agent's capabilities into the dynamic registry.
     */
    public registerAgent(agent: Agent) {
        if (!agent.capabilities || agent.capabilities.length === 0) return;

        agent.capabilities.forEach(cap => {
            if (!this.registry.has(cap)) {
                this.registry.set(cap, []);
            }
            const providers = this.registry.get(cap)!;

            // Idempotency: Remove if exists already
            const existingIdx = providers.findIndex(p => p.agentId === agent.id);
            if (existingIdx !== -1) providers.splice(existingIdx, 1);

            providers.push({
                agentId: agent.id,
                score: 1.0 // Default score, can be updated by QA
            });

            console.log(`[DCR] 🧩 Agent ${agent.name} registered for ${cap}`);
        });
    }

    /**
     * Unregisters an agent from all capabilities (for zombie purge)
     */
    public unregisterAgent(agentId: string) {
        let removedCount = 0;
        this.registry.forEach((providers, cap) => {
            const idx = providers.findIndex(p => p.agentId === agentId);
            if (idx !== -1) {
                providers.splice(idx, 1);
                removedCount++;
            }
        });
        if (removedCount > 0) {
            console.log(`[DCR] 🧹 Agent ${agentId} unregistered from ${removedCount} capabilities`);
        }
    }

    /**
     * Finds the best agents that fulfill the required capabilities.
     * Returns a set of unique Agent IDs.
     */
    public findProviders(requiredCapabilities: AgentCapability[]): string[] {
        const selectedAgents = new Set<string>();

        requiredCapabilities.forEach(cap => {
            const providers = this.registry.get(cap);
            if (providers && providers.length > 0) {
                // Strategy: Round Robin or Best Score. For now, take Top 1.
                // In future V6.1 -> We can return multiple for swarming.
                selectedAgents.add(providers[0].agentId);
            } else {
                console.warn(`[DCR] ⚠️ No provider found for capability: ${cap}`);
            }
        });

        return Array.from(selectedAgents);
    }

    /**
     * INTELLIGENT AGENT DISCOVERY
     * Combines semantic search with capability filtering for optimal agent selection.
     * 
     * @param taskDescription - Natural language description of the task
     * @param requiredCapabilities - Optional specific capabilities needed
     * @param options - Search options (maxAgents, tier, category)
     * @returns Array of agent IDs ranked by relevance and availability
     */
    public async findProvidersIntelligent(
        taskDescription: string,
        requiredCapabilities?: AgentCapability[],
        options?: {
            maxAgents?: number;
            requiredTier?: string;
            requiredCategory?: string;
        }
    ): Promise<string[]> {
        const { semanticAgentSearch } = await import('./semanticAgentSearch');

        console.log(`[DCR] 🧠 Intelligent search for: "${taskDescription.substring(0, 50)}..."`);

        // 1. Semantic search for relevant agents
        const semanticResults = await semanticAgentSearch.findBestAgents(
            taskDescription,
            {
                maxAgents: options?.maxAgents || 10,
                requiredTier: options?.requiredTier as any,
                requiredCategory: options?.requiredCategory
            }
        );

        // 2. Filter by required capabilities if specified
        let filtered = semanticResults;
        if (requiredCapabilities && requiredCapabilities.length > 0) {
            filtered = semanticResults.filter(result => {
                const agent = result.agent;
                return requiredCapabilities.every(cap =>
                    agent.capabilities?.includes(cap)
                );
            });

            console.log(`[DCR] 🔍 Filtered to ${filtered.length} agents with required capabilities`);
        }

        // 3. Return top agents (already sorted by finalScore)
        const topAgents = filtered
            .slice(0, options?.maxAgents || 5)
            .map(r => r.agent.id);

        console.log(`[DCR] ✅ Selected ${topAgents.length} agents:`, topAgents);
        return topAgents;
    }

    /**
     * Debug: Dump registry state
     */
    public getSnapshot(): any {
        const snapshot: any = {};
        this.registry.forEach((v, k) => {
            snapshot[k] = v.map(p => p.agentId);
        });
        return snapshot;
    }
}

export const capabilityRegistry = CapabilityRegistry.getInstance();
