/**
 * LEARNING LOOP
 * ═══════════════════════════════════════════════════════════════
 * Analyzes failures and user feedback to improve system performance.
 * 
 * Flow:
 * 1. Collect failures from experienceBuffer
 * 2. Group by context (tool, agent, feature)
 * 3. Detect patterns (3+ similar failures = pattern)
 * 4. Generate improvement suggestions via LLM
 * 5. Store learnings in eternal memory
 * 6. Optionally auto-apply safe improvements
 */

import { backgroundLLM } from './backgroundLLMService';
import { continuum } from './continuumMemory';
import { systemBus } from './systemBus';
import { SystemProtocol, MemoryTier } from '../types';

interface Experience {
    timestamp: number;
    context: string;
    action: string;
    result: 'SUCCESS' | 'FAILURE';
    error?: string;
    solution?: string;
    source: string;
}

interface LearningInsight {
    context: string;
    failureCount: number;
    pattern: string;
    rootCause: string;
    suggestedFix: string;
    confidence: number; // 0-1
    autoApplicable: boolean;
}

interface LearningStats {
    insightsGenerated: number;
    patternsDetected: number;
    autoApplied: number;
    lastAnalysis: number;
}

class LearningLoop {
    private static instance: LearningLoop;
    private stats: LearningStats = {
        insightsGenerated: 0,
        patternsDetected: 0,
        autoApplied: 0,
        lastAnalysis: 0
    };

    private readonly MIN_FAILURES_FOR_PATTERN = 3;
    private readonly AUTO_APPLY_CONFIDENCE = 0.9;
    private readonly AUTO_APPLY_MIN_FAILURES = 5;

    private constructor() {
        console.log('[LEARNING_LOOP] 🧠 Initialized - Autonomous improvement active');
    }

    public static getInstance(): LearningLoop {
        if (!LearningLoop.instance) {
            LearningLoop.instance = new LearningLoop();
        }
        return LearningLoop.instance;
    }

    /**
     * Analyze recent failures and generate insights
     */
    public async analyzeFailures(timeWindowMs: number = 24 * 60 * 60 * 1000): Promise<LearningInsight[]> {
        console.log('[LEARNING_LOOP] 🔍 Analyzing failures from last 24h...');

        try {
            // Get failures from experienceBuffer (dynamic import)
            const { experienceBuffer } = await import('./experienceBuffer');
            const recentFailures = await this.getRecentFailures(experienceBuffer, timeWindowMs);

            if (recentFailures.length === 0) {
                console.log('[LEARNING_LOOP] ✅ No failures to analyze');
                return [];
            }

            console.log(`[LEARNING_LOOP] Found ${recentFailures.length} failures`);

            // Group by context
            const grouped = this.groupByContext(recentFailures);

            // Generate insights for patterns
            const insights: LearningInsight[] = [];

            for (const [context, failures] of grouped) {
                if (failures.length >= this.MIN_FAILURES_FOR_PATTERN) {
                    console.log(`[LEARNING_LOOP] 🎯 Pattern detected: ${context} (${failures.length} failures)`);

                    const insight = await this.generateInsight(context, failures);
                    if (insight) {
                        insights.push(insight);
                        this.stats.patternsDetected++;
                    }
                }
            }

            this.stats.insightsGenerated += insights.length;
            this.stats.lastAnalysis = Date.now();

            // Store insights in memory
            for (const insight of insights) {
                await this.storeInsight(insight);
            }

            // Emit event for UI
            systemBus.emit(SystemProtocol.LEARNING_UPDATE, {
                insights,
                stats: this.stats
            }, 'LEARNING_LOOP');

            return insights;

        } catch (error: any) {
            console.error('[LEARNING_LOOP] ❌ Analysis failed:', error.message);
            return [];
        }
    }

    /**
     * Get recent failures from experience buffer
     */
    private async getRecentFailures(
        experienceBuffer: any,
        timeWindowMs: number
    ): Promise<Experience[]> {
        const cutoff = Date.now() - timeWindowMs;

        // Try to get failures from buffer
        if (typeof experienceBuffer.getRecentExperiences === 'function') {
            const all = await experienceBuffer.getRecentExperiences(100);
            return all.filter((e: Experience) =>
                e.result === 'FAILURE' && e.timestamp > cutoff
            );
        }

        // Fallback: search memory for failure patterns
        return [];
    }

    /**
     * Group experiences by context
     */
    private groupByContext(experiences: Experience[]): Map<string, Experience[]> {
        const grouped = new Map<string, Experience[]>();

        for (const exp of experiences) {
            const key = exp.context;
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key)!.push(exp);
        }

        return grouped;
    }

    /**
     * Generate insight using LLM
     */
    private async generateInsight(
        context: string,
        failures: Experience[]
    ): Promise<LearningInsight | null> {
        const errorsText = failures
            .map(f => `- Error: ${f.error || 'Unknown'}\n  Action: ${f.action}`)
            .slice(0, 10) // Limit to 10 for token efficiency
            .join('\n');

        const prompt = `Analyze these repeated failures and suggest improvements:

CONTEXT: ${context}
FAILURE COUNT: ${failures.length}
RECENT ERRORS:
${errorsText}

Respond with JSON:
{
    "pattern": "Brief description of the failure pattern",
    "rootCause": "Most likely root cause",
    "suggestedFix": "Specific, actionable fix",
    "confidence": 0.0-1.0,
    "autoApplicable": true/false (is this safe to auto-apply?)
}`;

        try {
            const response = await backgroundLLM.generate(prompt, {
                taskType: 'ANALYSIS',
                priority: 'LOW'
            });

            // Parse JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[LEARNING_LOOP] Failed to parse LLM response');
                return null;
            }

            const parsed = JSON.parse(jsonMatch[0]);

            return {
                context,
                failureCount: failures.length,
                pattern: parsed.pattern || 'Unknown pattern',
                rootCause: parsed.rootCause || 'Unknown cause',
                suggestedFix: parsed.suggestedFix || 'No fix suggested',
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
                autoApplicable: parsed.autoApplicable === true
            };

        } catch (error: any) {
            console.error('[LEARNING_LOOP] Failed to generate insight:', error.message);
            return null;
        }
    }

    /**
     * Store insight in eternal memory
     */
    private async storeInsight(insight: LearningInsight): Promise<void> {
        const content = `
LEARNING: ${insight.context}
Pattern: ${insight.pattern}
Root Cause: ${insight.rootCause}
Fix: ${insight.suggestedFix}
Confidence: ${(insight.confidence * 100).toFixed(0)}%
Auto-applicable: ${insight.autoApplicable}
        `.trim();

        await continuum.store(
            content,
            undefined,
            ['LEARNING', 'SYSTEM', 'INSIGHT', insight.context]
        );

        console.log(`[LEARNING_LOOP] 💾 Stored insight for: ${insight.context}`);
    }

    /**
     * Apply a learning insight (if safe)
     */
    public async applyInsight(insight: LearningInsight): Promise<boolean> {
        // Safety checks
        if (!insight.autoApplicable) {
            console.log('[LEARNING_LOOP] ⚠️ Insight not marked as auto-applicable');
            return false;
        }

        if (insight.confidence < this.AUTO_APPLY_CONFIDENCE) {
            console.log(`[LEARNING_LOOP] ⚠️ Confidence too low: ${insight.confidence}`);
            return false;
        }

        if (insight.failureCount < this.AUTO_APPLY_MIN_FAILURES) {
            console.log(`[LEARNING_LOOP] ⚠️ Not enough failures to auto-apply: ${insight.failureCount}`);
            return false;
        }

        // Apply insight based on context type
        console.log(`[LEARNING_LOOP] 🔧 Auto-applying insight for: ${insight.context}`);

        try {
            // Route to appropriate handler based on context
            if (insight.context.includes('tool') || insight.context.includes('TOOL')) {
                // Store tool improvement in memory for future reference
                await continuum.store(
                    `TOOL_IMPROVEMENT: ${insight.context}\nFix: ${insight.suggestedFix}\nConfidence: ${insight.confidence}`,
                    undefined,
                    ['LEARNING', 'TOOL_IMPROVEMENT', insight.context]
                );
                console.log(`[LEARNING_LOOP] ✅ Tool improvement stored: ${insight.suggestedFix.substring(0, 50)}...`);

            } else if (insight.context.includes('agent') || insight.context.includes('AGENT')) {
                // Apply agent behavior changes
                systemBus.emit(SystemProtocol.AGENT_EVOLVED, {
                    improvement: insight.suggestedFix,
                    source: 'LEARNING_LOOP',
                    confidence: insight.confidence
                }, 'LEARNING_LOOP');

            } else if (insight.context.includes('prompt') || insight.context.includes('PROMPT')) {
                // Store prompt refinements for use by prompt compiler
                await continuum.store(
                    `PROMPT_REFINEMENT: ${insight.suggestedFix}`,
                    undefined,
                    ['LEARNING', 'PROMPT_IMPROVEMENT', insight.context]
                );

            } else if (insight.context.includes('rate') || insight.context.includes('throttle')) {
                // Apply rate limiting adjustments
                systemBus.emit(SystemProtocol.CONFIG_MUTATION, {
                    type: 'RATE_LIMIT_ADJUSTMENT',
                    suggestion: insight.suggestedFix,
                    confidence: insight.confidence
                }, 'LEARNING_LOOP');
            }

            this.stats.autoApplied++;
            return true;

        } catch (applyError: any) {
            console.error(`[LEARNING_LOOP] ❌ Failed to apply insight:`, applyError.message);
            return false;
        }
    }

    /**
     * Schedule periodic analysis
     */
    public schedulePeriodicAnalysis(intervalMs: number = 6 * 60 * 60 * 1000): void {
        console.log(`[LEARNING_LOOP] ⏰ Scheduled analysis every ${intervalMs / 3600000}h`);

        setInterval(async () => {
            console.log('[LEARNING_LOOP] ⏰ Running scheduled analysis...');
            await this.analyzeFailures();
        }, intervalMs);
    }

    /**
     * Get learning stats
     */
    public getStats(): LearningStats {
        return { ...this.stats };
    }
}

export const learningLoop = LearningLoop.getInstance();
