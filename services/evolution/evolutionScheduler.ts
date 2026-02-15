/**
 * EVOLUTION SCHEDULER
 * ═══════════════════════════════════════════════════════════════
 * The "Proactive Brain" of Silhouette's Self-Evolution.
 * 
 * Orchestrates existing components to enable autonomous improvement:
 * - ToolEvolver: Analyzes tool performance and suggests optimizations
 * - IntrospectionEngine: Manages goals, thoughts, cognitive cycles
 * - SquadFactory: Spawns agent teams to execute complex improvements
 * - RemediationService: Mobilizes repair squads for failures
 * - AutoCorrection: Fixes CI errors using LLM
 * - GitIntegration: Creates PRs for code changes
 * 
 * KEY PRINCIPLE: This service ORCHESTRATES, it does NOT duplicate.
 */

import { toolEvolver } from '../tools/toolEvolver';
import { introspection } from '../introspectionEngine';
import { squadFactory, SquadRequest } from '../factory/squadFactory';
import { remediation } from '../remediationService';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

interface EvolutionConfig {
    toolEvolutionIntervalMs: number;      // How often to analyze tools (default: 6 hours)
    goalExecutionIntervalMs: number;      // How often to check for actionable goals (default: 30 min)
    autoExecuteApprovedGoals: boolean;    // Should we auto-execute HIGH priority approved goals?
    maxConcurrentEvolutions: number;      // Max simultaneous evolution tasks
}

const DEFAULT_CONFIG: EvolutionConfig = {
    toolEvolutionIntervalMs: 6 * 60 * 60 * 1000,   // 6 hours
    goalExecutionIntervalMs: 30 * 60 * 1000,        // 30 minutes
    autoExecuteApprovedGoals: true,
    maxConcurrentEvolutions: 2
    // Note: LLM Rate Limiting (RPM) is handled centrally by ZhipuService/GeminiService
    // and ProviderHealthManager. We do not throttle here to avoid double-limiting.
};

class EvolutionScheduler {
    private static instance: EvolutionScheduler;
    private config: EvolutionConfig;
    private isRunning: boolean = false;
    private activeEvolutions: number = 0;
    private toolEvolutionInterval: NodeJS.Timeout | null = null;
    private goalExecutionInterval: NodeJS.Timeout | null = null;

    private constructor(config: Partial<EvolutionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    public static getInstance(): EvolutionScheduler {
        if (!EvolutionScheduler.instance) {
            EvolutionScheduler.instance = new EvolutionScheduler();
        }
        return EvolutionScheduler.instance;
    }

    /**
     * Start the evolution scheduler
     * Called during server startup
     */
    public start(): void {
        if (this.isRunning) {
            console.log('[EVOLUTION] ⚠️ Scheduler already running');
            return;
        }

        // [OPTIMIZATION] Check PowerManager before starting
        import('../powerManager').then(({ powerManager }) => {
            if (!powerManager.isEvolutionEnabled) {
                console.log('[EVOLUTION] 💤 Disabled by PowerManager. Call start() manually when PERFORMANCE mode.');
                return;
            }
            this.activateScheduler();
        });
    }

    private activateScheduler(): void {
        if (this.isRunning) return;

        console.log('[EVOLUTION] 🧬 Starting Proactive Self-Evolution Scheduler...');
        this.isRunning = true;

        // Schedule periodic tool analysis
        this.toolEvolutionInterval = setInterval(
            () => this.runToolEvolutionCycle(),
            this.config.toolEvolutionIntervalMs
        );

        // Schedule periodic goal execution
        this.goalExecutionInterval = setInterval(
            () => this.executeActiveGoals(),
            this.config.goalExecutionIntervalMs
        );

        // Run initial analysis after a short delay (let system stabilize)
        setTimeout(() => {
            this.runToolEvolutionCycle();
        }, 30000); // 30 seconds after start

        // Emit startup event using valid SystemProtocol
        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            step: 'EVOLUTION_SCHEDULER',
            status: 'STARTED',
            config: this.config,
            timestamp: Date.now()
        });

        console.log('[EVOLUTION] ✅ Scheduler active. Tool analysis every 6h, goal check every 30min.');
    }

    /**
     * Stop the evolution scheduler
     */
    public stop(): void {
        if (!this.isRunning) return;

        console.log('[EVOLUTION] 🛑 Stopping scheduler...');

        if (this.toolEvolutionInterval) {
            clearInterval(this.toolEvolutionInterval);
            this.toolEvolutionInterval = null;
        }

        if (this.goalExecutionInterval) {
            clearInterval(this.goalExecutionInterval);
            this.goalExecutionInterval = null;
        }

        this.isRunning = false;
        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            step: 'EVOLUTION_SCHEDULER',
            status: 'STOPPED',
            timestamp: Date.now()
        });
    }

    /**
     * Run a tool evolution cycle
     * Analyzes all tools and generates improvement suggestions
     */
    private async runToolEvolutionCycle(): Promise<void> {
        console.log('[EVOLUTION] 🔬 Running tool evolution cycle...');

        try {
            const result = await toolEvolver.runEvolutionCycle(3);

            systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
                step: 'TOOL_EVOLUTION',
                status: 'COMPLETE',
                toolsAnalyzed: result.toolsAnalyzed,
                lowPerformers: result.lowPerformers,
                suggestionsGenerated: result.suggestionsGenerated,
                timestamp: result.timestamp
            });

            // Log high-priority suggestions for visibility
            for (const suggestion of result.suggestions.filter(s => s.priority === 'HIGH')) {
                console.log(`[EVOLUTION] 🚨 HIGH priority: ${suggestion.toolName} - ${suggestion.description}`);

                // If auto-execution is enabled, spawn a squad for implementation
                if (this.config.autoExecuteApprovedGoals && this.activeEvolutions < this.config.maxConcurrentEvolutions) {
                    await this.executeEvolutionSuggestion(suggestion);
                }
            }
        } catch (error) {
            console.error('[EVOLUTION] Tool evolution cycle failed:', error);
        }
    }

    /**
     * Execute an evolution suggestion by spawning a squad
     */
    private async executeEvolutionSuggestion(suggestion: any): Promise<void> {
        this.activeEvolutions++;

        try {
            console.log(`[EVOLUTION] 🦾 Executing suggestion: ${suggestion.toolName}`);

            // Spawn a squad to implement the suggestion
            const request: SquadRequest = {
                goal: `Optimize tool '${suggestion.toolName}': ${suggestion.description}. Implementation: ${suggestion.implementation}`,
                budget: 'BALANCED',
                context: 'Tool Evolution - Auto-Improvement'
            };
            const squad = await squadFactory.spawnSquad(request);

            systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
                step: 'EVOLUTION_SQUAD',
                status: 'SPAWNED',
                tool: suggestion.toolName,
                squadId: squad.id,
                goal: request.goal
            });

        } catch (error) {
            console.error(`[EVOLUTION] Failed to execute suggestion for ${suggestion.toolName}:`, error);
        } finally {
            this.activeEvolutions--;
        }
    }

    /**
     * Check for and execute active goals from IntrospectionEngine
     */
    private async executeActiveGoals(): Promise<void> {
        if (!this.config.autoExecuteApprovedGoals) return;
        if (this.activeEvolutions >= this.config.maxConcurrentEvolutions) return;

        try {
            const goal = introspection.getHighPriorityGoal();

            if (goal && goal.progress === 0) {
                console.log(`[EVOLUTION] 🎯 Executing goal: ${goal.description.substring(0, 50)}...`);
                this.activeEvolutions++;

                try {
                    // Update goal status
                    await introspection.updateGoalProgress(goal.id, 0.1);

                    // Spawn a squad to work on this goal
                    const request: SquadRequest = {
                        goal: goal.description,
                        budget: 'BALANCED',
                        context: `Goal Execution - Priority: ${goal.priority}`
                    };
                    const squad = await squadFactory.spawnSquad(request);

                    systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
                        step: 'GOAL_EXECUTION',
                        status: 'STARTED',
                        goalId: goal.id,
                        squadId: squad.id,
                        description: goal.description
                    });

                } catch (error) {
                    console.error(`[EVOLUTION] Failed to execute goal ${goal.id}:`, error);
                    // Use remediation service to diagnose the failure
                    await remediation.mobilizeSquad('EVOLUTION_SCHEDULER', [String(error)]);
                } finally {
                    this.activeEvolutions--;
                }
            }
        } catch (error) {
            console.error('[EVOLUTION] Goal execution check failed:', error);
        }
    }

    /**
     * Manually trigger an evolution cycle (for testing or admin override)
     */
    public async triggerEvolutionNow(): Promise<void> {
        console.log('[EVOLUTION] 🔧 Manual evolution triggered');
        await this.runToolEvolutionCycle();
        await this.executeActiveGoals();
    }

    /**
     * Get current scheduler status
     */
    public getStatus(): {
        isRunning: boolean;
        activeEvolutions: number;
        config: EvolutionConfig;
    } {
        return {
            isRunning: this.isRunning,
            activeEvolutions: this.activeEvolutions,
            config: this.config
        };
    }
}

export const evolutionScheduler = EvolutionScheduler.getInstance();
