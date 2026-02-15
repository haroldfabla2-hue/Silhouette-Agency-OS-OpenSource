import { agentFactory } from './factory/AgentFactory';
import { orchestrator } from './orchestrator';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';
import { agentPersistence } from './agentPersistence';

/**
 * PA-038: PeerReviewService
 * 
 * Enables supervisory agents to evolve each other, solving the paradox of 
 * "who watches the watchmen?" through mutual peer review.
 * 
 * This prevents bias from self-evaluation by having agents review each other.
 */

export class PeerReviewService {
    private static instance: PeerReviewService;

    // Map of who reviews whom (bidirectional peer relationships)
    // These are supervisor/specialist roles - they will be auto-created if missing
    private reviewPairs: Map<string, string> = new Map([
        ['qa-01', 'supervisor-01'],     // QA reviews Supervisor
        ['supervisor-01', 'qa-01'],     // Supervisor reviews QA
        ['dev-lead', 'architect-01'],   // Dev Lead reviews Architect
        ['architect-01', 'dev-lead'],   // Architect reviews Dev Lead
        ['research-01', 'sci-01'],      // Researcher reviews Scientist
        ['sci-01', 'research-01']       // Scientist reviews Researcher
    ]);

    // Blueprints for auto-creating missing agents
    private agentBlueprints: Map<string, { roleName: string; description: string; category: string; skills: string[] }> = new Map([
        ['supervisor-01', { roleName: 'Lead Supervisor', description: 'Oversees agent operations and quality', category: 'OPS', skills: ['supervision', 'quality control', 'team coordination'] }],
        ['architect-01', { roleName: 'System Architect', description: 'Designs system architecture and technical decisions', category: 'DEV', skills: ['architecture', 'system design', 'technical leadership'] }],
        ['research-01', { roleName: 'Research Lead', description: 'Conducts deep research and analysis', category: 'SCIENCE', skills: ['research', 'analysis', 'investigation'] }],
    ]);

    // MUTEX: Prevent concurrent peer review cycles
    private isRunning: boolean = false;

    private constructor() { }

    public static getInstance(): PeerReviewService {
        if (!PeerReviewService.instance) {
            PeerReviewService.instance = new PeerReviewService();
        }
        return PeerReviewService.instance;
    }

    /**
     * Run a full peer review cycle.
     * Each supervisor agent reviews its peer and triggers evolution if needed.
     * Missing agents are auto-created using AgentFactory.
     */
    public async runPeerReview(): Promise<{
        reviewed: number;
        evolved: number;
        skipped: number;
        created: number;
        results: Array<{ reviewer: string; target: string; score: number; evolved: boolean }>;
    }> {
        // MUTEX: Prevent concurrent peer review cycles
        if (this.isRunning) {
            console.log('[PEER REVIEW] ⏸️ Already running. Skipping duplicate call.');
            return { reviewed: 0, evolved: 0, skipped: 0, created: 0, results: [] };
        }
        this.isRunning = true;

        console.log('[PEER REVIEW] 🔍 Starting peer review cycle...');

        const results: Array<{ reviewer: string; target: string; score: number; evolved: boolean }> = [];
        let evolved = 0;
        let skipped = 0;
        let created = 0;

        for (const [reviewerId, targetId] of this.reviewPairs) {
            try {
                // =========================================================
                // RATE LIMIT PROTECTION: Delay between reviews to prevent
                // z.ai burst during Sleep Cycle
                // =========================================================
                const { congestionManager } = await import('./congestionManager');

                // Wait for congestion to clear
                while (congestionManager.isCongested()) {
                    console.log(`[PEER REVIEW] ⏸️ Waiting for congestion to clear...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                // Add delay between each review to respect z.ai rate limits
                // 15s between reviews = max 4 reviews per minute
                console.log(`[PEER REVIEW] ⏳ Rate limit pause (15s)...`);
                await new Promise(resolve => setTimeout(resolve, 15000));

                let target = orchestrator.getAgent(targetId);

                // =========================================================
                // AUTO-CREATE MISSING AGENTS using AgentFactory
                // =========================================================
                if (!target) {
                    // Double-check if agent was created by another process
                    const existingAgent = await agentPersistence.loadAgent(targetId);
                    if (existingAgent) {
                        console.log(`[PEER REVIEW] ✅ Agent ${targetId} found in persistence, registering...`);
                        orchestrator.registerAgent(existingAgent);
                        target = existingAgent;
                    } else {
                        console.log(`[PEER REVIEW] 🏗️ Agent ${targetId} not found. Auto-creating...`);

                        const newAgent = await this.autoCreateAgent(targetId);
                        if (newAgent) {
                            // CRITICAL: Register immediately to prevent race conditions
                            orchestrator.registerAgent(newAgent);
                            target = newAgent;
                            created++;
                            console.log(`[PEER REVIEW] ✅ Created agent ${targetId}`);

                            systemBus.emit(SystemProtocol.AGENT_EVOLVED, {
                                agentId: targetId,
                                agentName: newAgent.name,
                                improvement: 'Auto-created by PeerReviewService',
                                triggeredBy: 'PeerReview',
                                source: 'universalprompts'
                            });
                        }
                    }

                    if (!target) {
                        console.log(`[PEER REVIEW] ⏭️ Skipping ${targetId}: Auto-creation failed.`);
                        skipped++;
                        continue;
                    }
                }

                console.log(`[PEER REVIEW] ${reviewerId} evaluating ${targetId}...`);

                // Analyze the target agent
                const analysis = await agentFactory.analyzeAgent(target);
                console.log(`[PEER REVIEW] ${reviewerId} scored ${targetId}: ${analysis.comparisonScore}/100`);

                let didEvolve = false;

                // Evolve if score is below threshold
                const PEER_EVOLUTION_THRESHOLD = 70;
                if (analysis.comparisonScore < PEER_EVOLUTION_THRESHOLD) {
                    console.log(`[PEER REVIEW] 🧬 ${targetId} needs improvement. Triggering evolution...`);

                    const evolveResult = await agentFactory.evolveAgent(target);
                    if (evolveResult.evolved) {
                        evolved++;
                        didEvolve = true;

                        systemBus.emit(SystemProtocol.AGENT_EVOLVED, {
                            agentId: targetId,
                            agentName: target.name,
                            previousScore: analysis.comparisonScore,
                            newScore: evolveResult.agent.projectedScore,
                            triggeredBy: 'PeerReview',
                            reviewerId
                        });
                    }
                }

                results.push({
                    reviewer: reviewerId,
                    target: targetId,
                    score: analysis.comparisonScore,
                    evolved: didEvolve
                });

            } catch (error: any) {
                console.error(`[PEER REVIEW] ❌ Error reviewing ${targetId}:`, error.message);
                skipped++;
            }
        }

        console.log(`[PEER REVIEW] ✅ Cycle complete. Reviewed: ${results.length}, Evolved: ${evolved}, Created: ${created}, Skipped: ${skipped}`);

        // MUTEX: Release lock
        this.isRunning = false;

        return {
            reviewed: results.length,
            evolved,
            skipped,
            created,
            results
        };
    }

    /**
     * Add a new peer review pair.
     */
    public addReviewPair(reviewerId: string, targetId: string): void {
        this.reviewPairs.set(reviewerId, targetId);
    }

    /**
     * Get all configured review pairs.
     */
    public getReviewPairs(): Array<{ reviewer: string; target: string }> {
        return Array.from(this.reviewPairs.entries()).map(([reviewer, target]) => ({
            reviewer,
            target
        }));
    }

    /**
     * Auto-create a missing agent using AgentFactory and universalprompts
     */
    private async autoCreateAgent(agentId: string): Promise<any | null> {
        try {
            // Check if we have a blueprint for this agent
            const blueprint = this.agentBlueprints.get(agentId);

            if (blueprint) {
                // Use AgentFactory to architect the agent using universalprompts
                const agentDef = await agentFactory.architectAgent({
                    roleName: blueprint.roleName,
                    description: blueprint.description,
                    category: blueprint.category as any,
                    skills: blueprint.skills
                });

                // Override the ID to match expected
                agentDef.id = agentId;

                // Register with orchestrator
                await this.registerNewAgent(agentDef);

                return agentDef;
            } else {
                // No blueprint - use spawnForTask with generic description
                console.log(`[PEER REVIEW] No blueprint for ${agentId}, using dynamic spawn...`);
                const agentDef = await agentFactory.spawnForTask(`Create a supervisory agent with ID ${agentId} for peer review and quality assessment.`);

                if (agentDef) {
                    agentDef.id = agentId;
                    await this.registerNewAgent(agentDef);
                    return agentDef;
                }
            }
        } catch (error: any) {
            console.error(`[PEER REVIEW] ❌ Failed to auto-create ${agentId}:`, error.message);
        }
        return null;
    }

    /**
     * Register a newly created agent with the orchestrator
     */
    private async registerNewAgent(agentDef: any): Promise<void> {
        try {
            // Save to filesystem
            const fs = await import('fs/promises');
            const path = await import('path');
            const agentPath = path.join(process.cwd(), 'db', 'agents', `${agentDef.id}.json`);

            await fs.writeFile(agentPath, JSON.stringify(agentDef, null, 2));
            console.log(`[PEER REVIEW] 💾 Saved agent to ${agentPath}`);

            // Hydrate to make it active
            orchestrator.hydrateAgent(agentDef.id);
        } catch (error: any) {
            console.error(`[PEER REVIEW] ❌ Failed to register ${agentDef.id}:`, error.message);
        }
    }
}


export const peerReview = PeerReviewService.getInstance();
