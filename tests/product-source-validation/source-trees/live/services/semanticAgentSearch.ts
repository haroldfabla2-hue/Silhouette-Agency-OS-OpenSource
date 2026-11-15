import { Agent, AgentTier, AgentStatus } from '../types';
import { geminiService } from './geminiService';
import { orchestrator } from './orchestrator';

/**
 * Semantic Agent Search Service
 * 
 * Provides intelligent agent discovery using vector embeddings and multi-factor scoring.
 * Replaces simple capability matching with semantic similarity search.
 */

interface AgentSearchResult {
    agent: Agent;
    relevanceScore: number;
    workloadScore: number;
    teamFitScore: number;
    finalScore: number;
}

interface SearchOptions {
    maxAgents?: number;
    requiredTier?: AgentTier;
    requiredCategory?: string;
    excludeOverloaded?: boolean;
}

export class SemanticAgentSearch {
    private static instance: SemanticAgentSearch;
    private agentEmbeddings: Map<string, number[]> = new Map();
    private isIndexed: boolean = false;

    private constructor() { }

    public static getInstance(): SemanticAgentSearch {
        if (!SemanticAgentSearch.instance) {
            SemanticAgentSearch.instance = new SemanticAgentSearch();
        }
        return SemanticAgentSearch.instance;
    }

    /**
     * Index all agents with embeddings for semantic search
     */
    async indexAgents(agents: Agent[]): Promise<void> {
        console.log(`[SEMANTIC_SEARCH] 🔍 Indexing ${agents.length} agents...`);
        let indexed = 0;

        for (const agent of agents) {
            try {
                // Create rich description for embedding
                const description = this.createAgentDescription(agent);

                const embedding = await geminiService.generateEmbedding(description);
                if (embedding) {
                    this.agentEmbeddings.set(agent.id, embedding);
                    indexed++;
                }
            } catch (error) {
                console.error(`[SEMANTIC_SEARCH] Failed to index agent ${agent.id}:`, error);
            }
        }

        this.isIndexed = true;
        console.log(`[SEMANTIC_SEARCH] ✅ Indexed ${indexed}/${agents.length} agents`);
    }

    /**
     * Create a rich description of an agent for embedding
     */
    private createAgentDescription(agent: Agent): string {
        return `
            Role: ${agent.role}
            Name: ${agent.name}
            Category: ${agent.category}
            Tier: ${agent.tier}
            Role Type: ${agent.roleType}
            Skills: ${agent.capabilities?.join(', ') || 'general'}
            Team: ${agent.teamId}
            Description: ${(agent as any).systemInstruction?.substring(0, 500) || agent.role}
        `.trim();
    }

    /**
     * Find best agents for a task using semantic search
     */
    async findBestAgents(
        taskDescription: string,
        options: SearchOptions = {}
    ): Promise<AgentSearchResult[]> {
        const {
            maxAgents = 5,
            excludeOverloaded = true
        } = options;

        // Ensure agents are indexed
        if (!this.isIndexed) {
            const allAgents = orchestrator.getAgents();
            await this.indexAgents(allAgents);
        }

        // 1. Generate task embedding
        const taskEmbedding = await geminiService.generateEmbedding(taskDescription);
        if (!taskEmbedding) {
            console.error('[SEMANTIC_SEARCH] Failed to generate task embedding');
            return [];
        }

        // ═══════════════════════════════════════════════════════════════
        // PHASE 1: Calculate base scores (relevance + workload)
        // ═══════════════════════════════════════════════════════════════
        const candidates: Array<{
            agent: Agent;
            agentEmbedding: number[];
            relevanceScore: number;
            workloadScore: number;
        }> = [];

        for (const [agentId, agentEmbedding] of this.agentEmbeddings) {
            const agent = orchestrator.getAgent(agentId);
            if (!agent) continue;

            // Filter by requirements
            if (options.requiredTier && agent.tier !== options.requiredTier) continue;
            if (options.requiredCategory && agent.category !== options.requiredCategory) continue;

            // Calculate relevance (cosine similarity)
            const relevanceScore = this.cosineSimilarity(taskEmbedding, agentEmbedding);

            // Calculate workload score (lower is better)
            const workloadScore = this.calculateWorkloadScore(agent);

            // Skip overloaded agents if requested
            if (excludeOverloaded && workloadScore < 0.2) continue;

            candidates.push({
                agent,
                agentEmbedding,
                relevanceScore,
                workloadScore
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // PHASE 2: Greedy team assembly with progressive fit scoring
        // ═══════════════════════════════════════════════════════════════
        // Sort by base score (relevance + workload) for initial ordering
        candidates.sort((a, b) => {
            const scoreA = a.relevanceScore * 0.6 + a.workloadScore * 0.4;
            const scoreB = b.relevanceScore * 0.6 + b.workloadScore * 0.4;
            return scoreB - scoreA;
        });

        const team: AgentSearchResult[] = [];

        for (const candidate of candidates) {
            if (team.length >= maxAgents) break;

            // Calculate team fit against ALREADY SELECTED team members
            const teamFitScore = this.calculateTeamFitScore(candidate.agent, team);

            // Final score with team fit
            const finalScore =
                candidate.relevanceScore * 0.5 +
                candidate.workloadScore * 0.3 +
                teamFitScore * 0.2;

            team.push({
                agent: candidate.agent,
                relevanceScore: candidate.relevanceScore,
                workloadScore: candidate.workloadScore,
                teamFitScore,
                finalScore
            });
        }

        console.log(`[SEMANTIC_SEARCH] 🎯 Found ${team.length} agents for task`);
        team.forEach((r, i) => {
            console.log(`  ${i + 1}. ${r.agent.name} (score: ${r.finalScore.toFixed(3)}, relevance: ${r.relevanceScore.toFixed(3)})`);
        });

        return team;
    }

    /**
     * Cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            console.error('[SEMANTIC_SEARCH] Vector length mismatch');
            return 0;
        }

        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

        if (magnitudeA === 0 || magnitudeB === 0) return 0;

        return dotProduct / (magnitudeA * magnitudeB);
    }

    /**
     * Calculate availability score (0-1, higher = more available)
     * 
     * All agents can be selected - OFFLINE/HIBERNATED will be woken up.
     * Scoring reflects availability preference, not exclusion.
     */
    private calculateWorkloadScore(agent: Agent): number {
        if (agent.status === AgentStatus.CRITICAL) {
            return 0.1;  // Heavily penalized but still selectable for recovery
        }

        if (agent.status === AgentStatus.IDLE) {
            return 1.0;  // Fully available, ready immediately
        }

        if (agent.status === AgentStatus.OFFLINE || agent.status === AgentStatus.HIBERNATED) {
            return 0.95;  // Highly available - will be woken up
        }

        if (agent.status === AgentStatus.WORKING) {
            const idleTime = Date.now() - agent.lastActive;
            if (idleTime > 300000) return 0.5; // 5min idle while working = moderate load
            return 0.3;  // Recently active = busy
        }

        if (agent.status === AgentStatus.THINKING) {
            return 0.2;  // Deep processing, prefer not to interrupt
        }

        return 0.4; // Unknown status - moderate availability
    }

    /**
     * Calculate team fit score (0-1, higher is better)
     */
    private calculateTeamFitScore(agent: Agent, currentTeam: AgentSearchResult[]): number {
        if (currentTeam.length === 0) {
            // First agent: prefer leaders for team formation
            return agent.roleType === 'LEADER' ? 1.0 : 0.7;
        }

        const hasLeader = currentTeam.some(r => r.agent.roleType === 'LEADER');
        const categories = new Set(currentTeam.map(r => r.agent.category));

        let score = 0.5; // Base score

        // Diversity bonus: different categories complement each other
        if (!categories.has(agent.category)) {
            score += 0.3;
        }

        // Leadership bonus: team needs a leader
        if (!hasLeader && agent.roleType === 'LEADER') {
            score += 0.2;
        }

        // Avoid too many leaders
        if (hasLeader && agent.roleType === 'LEADER') {
            score -= 0.2;
        }

        return Math.max(0, Math.min(score, 1.0));
    }

    /**
     * Re-index a single agent (for updates)
     */
    async reindexAgent(agent: Agent): Promise<void> {
        const description = this.createAgentDescription(agent);
        const embedding = await geminiService.generateEmbedding(description);

        if (embedding) {
            this.agentEmbeddings.set(agent.id, embedding);
            console.log(`[SEMANTIC_SEARCH] 🔄 Reindexed agent: ${agent.name}`);
        }
    }

    /**
     * Remove agent from index
     */
    removeAgent(agentId: string): void {
        this.agentEmbeddings.delete(agentId);
    }

    /**
     * Get index statistics
     */
    getStats(): { totalAgents: number; isIndexed: boolean } {
        return {
            totalAgents: this.agentEmbeddings.size,
            isIndexed: this.isIndexed
        };
    }
}

export const semanticAgentSearch = SemanticAgentSearch.getInstance();
