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

import crypto from 'node:crypto';
import { backgroundLLM } from './backgroundLLMService';
import { continuum } from './continuumMemory';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';
import type { Experience as RecordedExperience, ExperienceType } from './experienceBuffer';

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

export interface LearningOutcome {
    stage: 'REJECTED' | 'UNHANDLED' | 'PROPOSAL_RECORDED' | 'FIX_GENERATED'
        | 'REMEDIATION_RETURNED' | 'CONFIG_SUGGESTION_EMITTED' | 'FAILED';
    applied: false;
    proposalMemoryId?: string;
    detail?: string;
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
        console.log('[LEARNING_LOOP] Initialized; proposal routing is not verified application');
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
        experienceBuffer: { getRecentDurable(count: number, type?: ExperienceType): Promise<RecordedExperience[]> },
        timeWindowMs: number
    ): Promise<Experience[]> {
        if (!Number.isFinite(timeWindowMs) || timeWindowMs <= 0) {
            throw new Error('Learning failure window must be finite and positive');
        }
        const cutoff = Date.now() - timeWindowMs;
        // Read original durable experiences after restart, not only this process's
        // RAM. Observation-only storage reads do not invoke a provider or ranking.
        return (await experienceBuffer.getRecentDurable(100, 'FAILURE'))
            .filter(e => e.type === 'FAILURE' && e.timestamp > cutoff)
            .map(e => ({ timestamp: e.timestamp, context: e.context,
                action: e.action, result: 'FAILURE', error: e.outcome,
                solution: e.lesson, source: e.agentId || 'SYSTEM' }));
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
        return (await this.routeInsight(insight)).applied;
    }

    /** Reports the actual boundary reached. No participant currently supplies
     * verified application evidence, so none of these outcomes is APPLIED. */
    public async routeInsight(insight: LearningInsight): Promise<LearningOutcome> {
        // Safety checks
        if (!insight.autoApplicable) {
            console.log('[LEARNING_LOOP] ⚠️ Insight not marked as auto-applicable');
            return { stage: 'REJECTED', applied: false };
        }

        if (insight.confidence < this.AUTO_APPLY_CONFIDENCE) {
            console.log(`[LEARNING_LOOP] ⚠️ Confidence too low: ${insight.confidence}`);
            return { stage: 'REJECTED', applied: false };
        }

        if (insight.failureCount < this.AUTO_APPLY_MIN_FAILURES) {
            console.log(`[LEARNING_LOOP] ⚠️ Not enough failures to auto-apply: ${insight.failureCount}`);
            return { stage: 'REJECTED', applied: false };
        }

        console.log(`[LEARNING_LOOP] Routing improvement proposal for: ${insight.context}`);

        const recordProposal = async (content: string, tags: string[]): Promise<string> => {
            const receiptTag = `learning-proposal:${crypto.createHash('sha256').update(content).digest('hex')}`;
            await continuum.store(content, undefined, [...tags, receiptTag]);
            const readback = await continuum.getLatestObservation(receiptTag);
            if (!readback || readback.content !== content) throw new Error('Learning proposal persistence unverified');
            return readback.id;
        };
        try {
            if (insight.context.includes('tool') || insight.context.includes('TOOL')) {
                // Route to autoCorrection for actual code-level fixes
                try {
                    const { autoCorrection } = await import('./autoCorrection');
                    const ciErrors = [
                        `[${insight.context}]: ${insight.suggestedFix}\nRoot Cause: ${insight.rootCause}\nPattern: ${insight.pattern}`
                    ];
                    const fixes = await autoCorrection.generateFixes(ciErrors, 1);
                    if (fixes && fixes.length > 0) {
                        console.log(`[LEARNING_LOOP] ✅ AutoCorrection generated ${fixes.length} fix(es) for: ${insight.context}`);
                        // Store the fix for the next git push cycle
                        const proposalMemoryId = await recordProposal(
                            `AUTO_FIX_GENERATED: ${insight.context}\n${JSON.stringify(fixes)}`,
                            ['LEARNING', 'AUTO_FIX', 'PROPOSED', insight.context]
                        );
                        return { stage: 'FIX_GENERATED', applied: false, proposalMemoryId };
                    } else {
                        // Fallback: store as knowledge for manual review
                        const proposalMemoryId = await recordProposal(
                            `TOOL_IMPROVEMENT: ${insight.context}\nFix: ${insight.suggestedFix}\nConfidence: ${insight.confidence}`,
                            ['LEARNING', 'TOOL_IMPROVEMENT', insight.context]
                        );
                        return { stage: 'PROPOSAL_RECORDED', applied: false, proposalMemoryId };
                    }
                } catch (acError: any) {
                    console.warn(`[LEARNING_LOOP] AutoCorrection unavailable: ${acError.message}. Storing as knowledge.`);
                    const proposalMemoryId = await recordProposal(
                        `TOOL_IMPROVEMENT: ${insight.context}\nFix: ${insight.suggestedFix}`,
                        ['LEARNING', 'TOOL_IMPROVEMENT', insight.context]
                    );
                    return { stage: 'PROPOSAL_RECORDED', applied: false, proposalMemoryId };
                }

            } else if (insight.context.includes('agent') || insight.context.includes('AGENT')) {
                // Route agent behavior improvements through remediation
                try {
                    const { remediation } = await import('./remediationService');
                    await remediation.mobilizeSquad(insight.context, [
                        `Learning Loop Insight (confidence: ${insight.confidence}):`,
                        `Pattern: ${insight.pattern}`,
                        `Root Cause: ${insight.rootCause}`,
                        `Suggested Fix: ${insight.suggestedFix}`
                    ]);
                    // The participant returns void even for backoff/skipped work.
                    return { stage: 'REMEDIATION_RETURNED', applied: false,
                        detail: 'Participant returned without an application receipt' };
                } catch (remError: any) {
                    console.warn(`[LEARNING_LOOP] Remediation unavailable: ${remError.message}`);
                    systemBus.emit(SystemProtocol.LEARNING_UPDATE, {
                        improvement: insight.suggestedFix,
                        source: 'LEARNING_LOOP',
                        status: 'proposal_not_applied',
                        confidence: insight.confidence
                    }, 'LEARNING_LOOP');
                    return { stage: 'FAILED', applied: false, detail: remError.message };
                }

            } else if (insight.context.includes('prompt') || insight.context.includes('PROMPT')) {
                const proposalMemoryId = await recordProposal(
                    `PROMPT_REFINEMENT: ${insight.suggestedFix}`,
                    ['LEARNING', 'PROMPT_IMPROVEMENT', insight.context]
                );
                return { stage: 'PROPOSAL_RECORDED', applied: false, proposalMemoryId };

            } else if (insight.context.includes('rate') || insight.context.includes('throttle')) {
                systemBus.emit(SystemProtocol.CONFIG_MUTATION, {
                    type: 'RATE_LIMIT_ADJUSTMENT',
                    suggestion: insight.suggestedFix,
                    confidence: insight.confidence
                }, 'LEARNING_LOOP');
                return { stage: 'CONFIG_SUGGESTION_EMITTED', applied: false };
            }

            return { stage: 'UNHANDLED', applied: false };

        } catch (applyError: any) {
            console.error(`[LEARNING_LOOP] ❌ Failed to apply insight:`, applyError.message);
            return { stage: 'FAILED', applied: false, detail: applyError.message };
        }
    }

    /**
     * Schedule periodic analysis
     */
    public schedulePeriodicAnalysis(intervalMs: number = 6 * 60 * 60 * 1000): void {
        console.log(`[LEARNING_LOOP] ⏰ Scheduled analysis every ${intervalMs / 3600000}h`);

        setInterval(async () => {
            // [THROTTLE] PowerManager resource modes can pause the periodic
            // learning loop (isLearningLoopEnabled). The throttle is a
            // resource hint, not an authority: unreadable -> full capability.
            // The authority ceiling (autonomy Tool_Evolution / allowEvolution)
            // is applied where this loop is started (server boot loader).
            try {
                const { powerManager } = await import('./powerManager');
                if (!powerManager.isLearningLoopEnabled) {
                    console.log('[LEARNING_LOOP] 💤 Scheduled analysis paused by PowerManager mode (throttle).');
                    return;
                }
            } catch { /* throttle unavailable -> full capability */ }
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
