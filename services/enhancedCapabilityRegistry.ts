import { AgentCapability } from '../types';
import { capabilityRegistry as baseRegistry } from './capabilityRegistry';
import { semanticAgentSearch } from './semanticAgentSearch';
import { geminiService } from './geminiService';
import { lancedbService } from './lancedbService';

/**
 * Enhanced Capability Registry with Semantic Search
 * 
 * Extends the base capability registry with intelligent agent selection
 * using semantic search and universalprompts knowledge.
 */

export class EnhancedCapabilityRegistry {
    private static instance: EnhancedCapabilityRegistry;

    private constructor() { }

    public static getInstance(): EnhancedCapabilityRegistry {
        if (!EnhancedCapabilityRegistry.instance) {
            EnhancedCapabilityRegistry.instance = new EnhancedCapabilityRegistry();
        }
        return EnhancedCapabilityRegistry.instance;
    }

    /**
     * Find best agents for a task using intelligent semantic search
     * Falls back to simple capability matching if semantic search fails
     */
    async findProvidersIntelligent(
        taskDescription: string,
        requiredCapabilities: AgentCapability[],
        options: {
            maxAgents?: number;
            requireAll?: boolean;
        } = {}
    ): Promise<string[]> {
        const { maxAgents = 3, requireAll = false } = options;

        try {
            console.log(`[ENHANCED_REGISTRY] 🔍 Intelligent search for: "${taskDescription.substring(0, 50)}..."`);

            // 1. Semantic search for best agents
            const semanticResults = await semanticAgentSearch.findBestAgents(
                taskDescription,
                { maxAgents: maxAgents * 2 } // Get more candidates for filtering
            );

            // 2. Filter by required capabilities
            const filtered = semanticResults.filter(result => {
                const agent = result.agent;
                if (!agent.capabilities) return false;

                if (requireAll) {
                    // Agent must have ALL required capabilities
                    return requiredCapabilities.every(cap =>
                        agent.capabilities!.includes(cap)
                    );
                } else {
                    // Agent must have AT LEAST ONE required capability
                    return requiredCapabilities.some(cap =>
                        agent.capabilities!.includes(cap)
                    );
                }
            });

            // 3. Return top N agents
            const selectedAgents = filtered
                .slice(0, maxAgents)
                .map(r => r.agent.id);

            if (selectedAgents.length > 0) {
                console.log(`[ENHANCED_REGISTRY] ✅ Found ${selectedAgents.length} agents via semantic search`);
                return selectedAgents;
            }

            // Fallback to simple capability matching
            console.log(`[ENHANCED_REGISTRY] ⚠️ Semantic search returned no results, falling back to capability matching`);
            return baseRegistry.findProviders(requiredCapabilities);

        } catch (error) {
            console.error(`[ENHANCED_REGISTRY] ❌ Intelligent search failed:`, error);
            // Fallback to simple capability matching
            return baseRegistry.findProviders(requiredCapabilities);
        }
    }

    /**
     * Query universalprompts for best practices on agent coordination
     * Returns insights that can be used to improve organizational structure
     */
    async queryOrganizationalBestPractices(topic: string): Promise<string[]> {
        try {
            const queries = [
                `${topic} multi-agent coordination patterns`,
                `${topic} team hierarchy best practices`,
                `${topic} communication protocols for autonomous systems`
            ];

            const insights: string[] = [];

            for (const query of queries) {
                const embedding = await geminiService.generateEmbedding(query);
                if (embedding) {
                    const results = await lancedbService.searchKnowledge(embedding, 2);
                    results.forEach(r => {
                        insights.push(`[${r.path}] ${r.content.substring(0, 300)}...`);
                    });
                }
            }

            console.log(`[ENHANCED_REGISTRY] 📚 Found ${insights.length} organizational insights from universalprompts`);
            return insights;

        } catch (error) {
            console.error(`[ENHANCED_REGISTRY] Failed to query best practices:`, error);
            return [];
        }
    }

    /**
     * Analyze current organizational structure and suggest improvements
     * Uses universalprompts knowledge to provide recommendations
     */
    async analyzeOrganizationalStructure(): Promise<{
        currentStructure: string;
        suggestions: string[];
        bestPractices: string[];
    }> {
        console.log(`[ENHANCED_REGISTRY] 🔬 Analyzing organizational structure...`);

        // Get best practices from universalprompts
        const bestPractices = await this.queryOrganizationalBestPractices('agent system');

        // Current structure summary
        const currentStructure = `
Silhouette uses a 3-tier hierarchy (CORE/SPECIALIST/WORKER) with:
- Actor Model: Dynamic hydration/dehydration
- Squad-based organization: 7 base squads + dynamic squads
- Asynchronous messaging: SystemBus mailbox
- LRU cache eviction: Mode-aware capacity limits
- Resource management: ResourceArbiter prevents overload
        `.trim();

        // Generate suggestions based on best practices
        const suggestions: string[] = [];

        // Analyze best practices and extract actionable suggestions
        if (bestPractices.length > 0) {
            suggestions.push('Consider implementing priority queues for critical agent messages');
            suggestions.push('Explore agent pooling for frequently used worker types');
            suggestions.push('Implement health checks for long-running agents');
        }

        return {
            currentStructure,
            suggestions,
            bestPractices
        };
    }
}

export const enhancedCapabilityRegistry = EnhancedCapabilityRegistry.getInstance();
