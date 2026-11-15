import { startLearningAnalysisTimer } from '../server/lifecycle/bootTimers';
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
import { canonicalLearningAnalysisInput } from './selfdev/learningAnalysisInput';
import { backgroundLLM } from './backgroundLLMService';
import { continuum } from './continuumMemory';
import { systemBus } from './systemBus';
import { SystemProtocol, MemoryTier } from '../types';
import type { Experience as RecordedExperience, ExperienceType } from './experienceBuffer';

interface Experience {
    id: string;
    incident?: RecordedExperience['incident'];
    timestamp: number;
    context: string;
    action: string;
    result: 'SUCCESS' | 'FAILURE';
    error?: string;
    solution?: string;
    source: string;
}

export interface LearningInsight {
    /** Captured by analysis, never supplied by model JSON. */
    failureExperienceIds?: string[];
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
    cycleId?: string;
    verification?: 'BASELINE_ORACLE_REQUIRED';
    detail?: string;
}

export type LearningAnalysisResult =
    | { status: 'COMPLETE'; insights: LearningInsight[]; failureCount: number }
    | { status: 'FAILED' | 'UNAVAILABLE'; detail: string };

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
    public async analyzeFailures(timeWindowMs: number = 24 * 60 * 60 * 1000): Promise<LearningAnalysisResult> {
        console.log('[LEARNING_LOOP] 🔍 Analyzing failures from last 24h...');

        let phase: 'VALIDATION' | 'INPUT' | 'ANALYSIS' = 'VALIDATION';
        try {
            // Get failures from experienceBuffer (dynamic import)
            if (!Number.isFinite(timeWindowMs) || timeWindowMs <= 0) throw new Error('Invalid analysis window');
            phase = 'INPUT';
            const { experienceBuffer } = await import('./experienceBuffer');
            const { incidentRegistry } = await import('./incidentRegistry');
            const { memoryRepairMapping } = await import('./selfdev/incidentMappings');
            // Bounded episode history, including recovery before next sweep. The
            // original firstSeen time is never refreshed to create new failures.
            const episodes = incidentRegistry.getIncidentEpisodesSince(Date.now() - timeWindowMs, 101);
            if (episodes.length > 100) throw new Error('Incident scan bound exhausted; coverage unavailable');
            for (const incident of episodes) {
                if (memoryRepairMapping(incident.source) && incident.firstSeen > Date.now() - timeWindowMs) {
                    await experienceBuffer.recordIncidentFailure(incident);
                }
            }
            const recentFailures = await this.getRecentFailures(experienceBuffer, timeWindowMs);
            phase = 'ANALYSIS';

            if (recentFailures.length === 0) {
                console.log('[LEARNING_LOOP] ✅ No failures to analyze');
                return { status: 'COMPLETE', insights: [], failureCount: 0 };
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
                    }
                }
            }

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

            return { status: 'COMPLETE', insights, failureCount: recentFailures.length };

        } catch (error: any) {
            console.error('[LEARNING_LOOP] ❌ Analysis failed:', error.message);
            return { status: phase === 'INPUT' ? 'UNAVAILABLE' : 'FAILED', detail: String(error.message || error) };
        }
    }

    /**
     * Get recent failures from experience buffer
     */
    private async getRecentFailures(
        experienceBuffer: { getRecentDurable(count: number, type?: ExperienceType, requireComplete?: boolean): Promise<RecordedExperience[]> },
        timeWindowMs: number
    ): Promise<Experience[]> {
        if (!Number.isFinite(timeWindowMs) || timeWindowMs <= 0) {
            throw new Error('Learning failure window must be finite and positive');
        }
        const cutoff = Date.now() - timeWindowMs;
        // Read original durable experiences after restart, not only this process's
        // RAM. Observation-only storage reads do not invoke a provider or ranking.
        return (await experienceBuffer.getRecentDurable(100, 'FAILURE', true))
            .filter(e => e.type === 'FAILURE' && e.timestamp > cutoff)
            .map(e => ({ id: e.id, incident: e.incident, timestamp: e.timestamp, context: e.context,
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
            const { memoryRepairMapping } = await import('./selfdev/incidentMappings');
            let admission: { hash: string; cachedResult?: string } | undefined;
            const ledger = await import('./selfdev/learningAnalysisLedger');
            if (memoryRepairMapping(context)) {
                const input = canonicalLearningAnalysisInput(context, failures);
                admission = ledger.admitLearningAnalysis(input);
                if (admission.cachedResult !== undefined) {
                    const cached = JSON.parse(admission.cachedResult) as LearningInsight;
                    if (!cached || cached.context !== context || cached.failureCount !== failures.length
                        || !['pattern', 'rootCause', 'suggestedFix'].every(key => typeof (cached as any)[key] === 'string' && (cached as any)[key].length > 0)
                        || !Number.isFinite(cached.confidence) || cached.confidence < 0 || cached.confidence > 1 || typeof cached.autoApplicable !== 'boolean'
                        || JSON.stringify(cached.failureExperienceIds) !== JSON.stringify(failures.map(f => f.id).sort())) {
                        throw new Error('Analysis cached provenance mismatch');
                    }
                    return cached;
                }
            }
            const response = await backgroundLLM.generate(prompt, {
                taskType: 'ANALYSIS',
                priority: 'LOW'
            });

            // Parse JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[LEARNING_LOOP] Failed to parse LLM response');
                throw new Error('Invalid insight response: no JSON');
            }

            const parsed = JSON.parse(jsonMatch[0]);
            if (!['pattern', 'rootCause', 'suggestedFix'].every(key => typeof parsed[key] === 'string' && parsed[key].length > 0)
                || !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1
                || typeof parsed.autoApplicable !== 'boolean') throw new Error('Invalid insight response fields');

            const insight: LearningInsight = {
                context,
                failureExperienceIds: failures.map(f => f.id).sort(),
                failureCount: failures.length,
                pattern: parsed.pattern || 'Unknown pattern',
                rootCause: parsed.rootCause || 'Unknown cause',
                suggestedFix: parsed.suggestedFix || 'No fix suggested',
                confidence: parsed.confidence,
                autoApplicable: parsed.autoApplicable === true
            };
            if (admission) ledger.completeLearningAnalysis(admission.hash, JSON.stringify(insight));
            this.stats.insightsGenerated++;
            this.stats.patternsDetected++;
            return insight;

        } catch (error: any) {
            console.error('[LEARNING_LOOP] Failed to generate insight:', error.message);
            throw error;
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

        const tag = `learning-insight:${crypto.createHash('sha256').update(JSON.stringify(insight)).digest('hex')}`;
        const prior = await continuum.getLatestObservation(tag);
        if (prior && prior.content !== content) throw new Error('Insight identity conflict');
        if (!prior) await continuum.store(content, MemoryTier.LONG, ['LEARNING', 'SYSTEM', 'INSIGHT', insight.context, tag], true);
        const readback = await continuum.getLatestObservation(tag);
        if (!readback || readback.content !== content) throw new Error('Insight persistence unverified');

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

        if (!Number.isFinite(insight.confidence) || insight.confidence < this.AUTO_APPLY_CONFIDENCE) {
            console.log(`[LEARNING_LOOP] ⚠️ Confidence too low: ${insight.confidence}`);
            return { stage: 'REJECTED', applied: false };
        }

        if (!Number.isInteger(insight.failureCount) || insight.failureCount < this.AUTO_APPLY_MIN_FAILURES) {
            console.log(`[LEARNING_LOOP] ⚠️ Not enough failures to auto-apply: ${insight.failureCount}`);
            return { stage: 'REJECTED', applied: false };
        }

        console.log(`[LEARNING_LOOP] Routing improvement proposal for: ${insight.context}`);

        const recordProposal = async (content: string, tags: string[]): Promise<string> => {
            const receiptTag = `learning-proposal:${crypto.createHash('sha256').update(content).digest('hex')}`;
            const existing = await continuum.getLatestObservation(receiptTag);
            if (existing?.content === content) return existing.id;
            // A durable proposal receipt must read back canonical storage, not only RAM.
            await continuum.store(content, MemoryTier.MEDIUM, [...tags, receiptTag], true);
            const readback = await continuum.getLatestObservation(receiptTag);
            if (!readback || readback.content !== content) throw new Error('Learning proposal persistence unverified');
            return readback.id;
        };
        try {
            const { memoryRepairMapping } = await import('./selfdev/incidentMappings');
            if (memoryRepairMapping(insight.context)) {
                // Exact durable incident source, not a substring inferred by a planner.
                const { incidentRegistry } = await import('./incidentRegistry');
                const { experienceBuffer } = await import('./experienceBuffer');
                const ids = insight.failureExperienceIds;
                if (!ids || ids.length !== insight.failureCount || new Set(ids).size !== ids.length) {
                    return { stage: 'REJECTED', applied: false, detail: 'Original distinct durable failure IDs required' };
                }
                const history = await experienceBuffer.getRecentDurable(100, 'FAILURE', true);
                const evidence = ids.map(id => history.find(e => e.id === id));
                if (evidence.some(e => {
                    if (!e || e.context !== insight.context || !e.incident || e.incident.source !== insight.context) return true;
                    const original = incidentRegistry.getIncident(e.incident.id);
                    return !original || original.source !== e.context || original.firstSeen !== e.timestamp
                        || e.outcome !== original.summary + (original.detail ? `: ${original.detail}` : '');
                })) {
                    return { stage: 'REJECTED', applied: false, detail: 'Original incident evidence unavailable or mismatched' };
                }
                const cycles = (await import('./selfdev/cycleService')).selfDevCycleService.list();
                const originals = evidence.map(e => incidentRegistry.getIncident(e!.incident!.id)!);
                const replayEpisode = originals.find(i => cycles.some(c => c.learningProposal?.incidentId === i.id && c.learningProposal?.source === i.source));
                const incident = originals.filter(i => i.status === 'open' && i.source === insight.context)
                    .sort((a, b) => a.firstSeen - b.firstSeen || a.id.localeCompare(b.id))[0] || replayEpisode;
                if (!incident) return { stage: 'UNHANDLED', applied: false, detail: 'No original open incident remains' };
                const { selfDevCycleService } = await import('./selfdev/cycleService');
                const prior = selfDevCycleService.list().find(c => c.learningProposal?.source === incident.source
                    && c.learningProposal?.incidentId === incident.id);
                if (prior) {
                    const linked = prior.learningProposal!;
                    if (!linked.failureExperienceIds?.length) throw new Error('Legacy proposal lacks verified provenance; review required');
                    const original = await continuum.getLatestObservation(`learning-origin:${incident.id}`);
                    if (!original || original.id !== linked.memoryId) throw new Error('Original proposal persistence unavailable');
                    const saved = JSON.parse(original.content);
                    if (saved.version !== 1 || saved.source !== linked.source || saved.incidentId !== linked.incidentId
                        || JSON.stringify(saved.failureExperienceIds) !== JSON.stringify(linked.failureExperienceIds)) {
                        throw new Error('Original proposal content/linkage conflict');
                    }
                    const replay = selfDevCycleService.createLearningProposal({ memoryId: linked.memoryId,
                        source: linked.source, incidentId: linked.incidentId, failureExperienceIds: linked.failureExperienceIds,
                        issue: prior.issue });
                    return { stage: 'PROPOSAL_RECORDED', applied: false, proposalMemoryId: linked.memoryId, cycleId: replay.id,
                        verification: 'BASELINE_ORACLE_REQUIRED', detail: 'Original proposal replayed; no planner or patch executed' };
                }
                const originTag = `learning-origin:${incident.id}`;
                const orphan = await continuum.getLatestObservation(originTag);
                let proposalMemoryId: string;
                let originalIds: string[];
                if (orphan) {
                    const saved = JSON.parse(orphan.content);
                    if (saved.version !== 1 || saved.incidentId !== incident.id || saved.source !== incident.source
                        || !Array.isArray(saved.failureExperienceIds) || saved.failureExperienceIds.length < 5
                        || saved.failureExperienceIds.some((id: unknown) => typeof id !== 'string')) {
                        throw new Error('Orphan proposal has invalid original provenance');
                    }
                    originalIds = saved.failureExperienceIds;
                    // Revalidate original evidence rather than substituting newer model output.
                    if (new Set(originalIds).size !== originalIds.length || originalIds.some(id => !history.some(e => e.id === id
                        && e.context === insight.context && e.incident && incidentRegistry.getIncident(e.incident.id)))) {
                        throw new Error('Orphan proposal original evidence unavailable');
                    }
                    proposalMemoryId = orphan.id;
                } else {
                    originalIds = [...ids].sort();
                    proposalMemoryId = await recordProposal(JSON.stringify({ version: 1, source: incident.source,
                        incidentId: incident.id, failureExperienceIds: originalIds, pattern: insight.pattern,
                        suggestedFix: insight.suggestedFix, authority: 'UNTRUSTED_PROPOSAL_ONLY' }),
                        ['LEARNING', 'MEMORY_REPAIR', 'PROPOSED', insight.context, originTag]);
                }
                const cycle = selfDevCycleService.createLearningProposal({ memoryId: proposalMemoryId,
                    source: incident.source, incidentId: incident.id, failureExperienceIds: originalIds, issue: `Memory repair proposal for incident ${incident.id}: ${incident.summary}` });
                return { stage: 'PROPOSAL_RECORDED', applied: false, proposalMemoryId, cycleId: cycle.id,
                    verification: 'BASELINE_ORACLE_REQUIRED', detail: 'HUMAN_APPROVAL_PENDING; no planner or patch executed; independent baseline/oracle required' };
            }
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

        startLearningAnalysisTimer(async () => {
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
            const result = await this.analyzeFailures();
            if (result.status !== 'COMPLETE') console.warn(`[LEARNING_LOOP] ${result.status}: ${result.detail}`);
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
