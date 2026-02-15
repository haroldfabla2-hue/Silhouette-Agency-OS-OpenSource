/**
 * TOOL EVOLVER
 * ═══════════════════════════════════════════════════════════════
 * Analyzes tool performance and suggests/applies optimizations.
 * 
 * Features:
 * - Performance analysis (success rate, execution time)
 * - Automatic improvement suggestions via LLM
 * - Evolution cycles (scheduled or on-demand)
 * - Integration with learning loop
 */

import { toolRegistry } from './toolRegistry';
import { backgroundLLM } from '../backgroundLLMService';
import { experienceBuffer } from '../experienceBuffer';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

interface ToolPerformanceReport {
    name: string;
    category: string;
    usageCount: number;
    successCount: number;
    successRate: number;
    avgExecutionTime?: number;
    lastUsed?: number;
    needsOptimization: boolean;
    issues: string[];
}

interface EvolutionSuggestion {
    toolName: string;
    type: 'PROMPT' | 'PARAMS' | 'HANDLER' | 'DEPRECATE';
    description: string;
    implementation: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    confidence: number;
}

interface EvolutionCycleResult {
    timestamp: number;
    toolsAnalyzed: number;
    lowPerformers: number;
    suggestionsGenerated: number;
    suggestions: EvolutionSuggestion[];
}

class ToolEvolver {
    private static instance: ToolEvolver;

    private readonly LOW_SUCCESS_THRESHOLD = 0.7; // 70% success rate
    private readonly MIN_USAGE_FOR_ANALYSIS = 5;  // At least 5 uses

    private constructor() {
        console.log('[TOOL_EVOLVER] 🧬 Initialized - Evolution engine active');
    }

    public static getInstance(): ToolEvolver {
        if (!ToolEvolver.instance) {
            ToolEvolver.instance = new ToolEvolver();
        }
        return ToolEvolver.instance;
    }

    /**
     * Analyze all tools and generate performance reports
     */
    public async analyzeAllTools(): Promise<ToolPerformanceReport[]> {
        const tools = toolRegistry.getAllTools();
        const reports: ToolPerformanceReport[] = [];

        for (const tool of tools) {
            const report = await this.analyzeTool(tool.name);
            if (report) {
                reports.push(report);
            }
        }

        // Sort by success rate (ascending - worst first)
        reports.sort((a, b) => a.successRate - b.successRate);

        return reports;
    }

    /**
     * Analyze a single tool's performance
     */
    public async analyzeTool(toolName: string): Promise<ToolPerformanceReport | null> {
        const tool = toolRegistry.getTool(toolName);
        if (!tool) {
            console.warn(`[TOOL_EVOLVER] Tool not found: ${toolName}`);
            return null;
        }

        const usageCount = tool.usageCount || 0;
        const successCount = tool.successCount || 0;
        const successRate = usageCount > 0 ? successCount / usageCount : 1;

        const issues: string[] = [];

        // Check for issues
        if (successRate < this.LOW_SUCCESS_THRESHOLD && usageCount >= this.MIN_USAGE_FOR_ANALYSIS) {
            issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
        }

        if (usageCount === 0 && tool.createdAt && Date.now() - tool.createdAt > 7 * 24 * 60 * 60 * 1000) {
            issues.push('Unused for over 7 days');
        }

        const needsOptimization = issues.length > 0;

        return {
            name: tool.name,
            category: tool.category,
            usageCount,
            successCount,
            successRate,
            lastUsed: tool.lastUsed,
            needsOptimization,
            issues
        };
    }

    /**
     * Generate evolution suggestions for underperforming tools
     */
    public async suggestEvolution(toolName: string): Promise<EvolutionSuggestion | null> {
        const tool = toolRegistry.getTool(toolName);
        if (!tool) return null;

        const report = await this.analyzeTool(toolName);
        if (!report || !report.needsOptimization) {
            console.log(`[TOOL_EVOLVER] ${toolName} doesn't need optimization`);
            return null;
        }

        console.log(`[TOOL_EVOLVER] 🔬 Generating evolution suggestion for: ${toolName}`);

        // Get failure experiences for this tool
        let failureContext = '';
        try {
            const failures = experienceBuffer.getRecent(20, 'FAILURE');
            const toolFailures = failures
                .filter((e: any) => e.context?.includes(toolName) && e.result === 'FAILURE')
                .slice(0, 5);

            if (toolFailures.length > 0) {
                failureContext = `\nRecent failures:\n${toolFailures.map((f: any) =>
                    `- ${f.error || 'Unknown error'}`
                ).join('\n')}`;
            }
        } catch { }

        const prompt = `Analyze this underperforming tool and suggest improvements:

TOOL NAME: ${tool.name}
DESCRIPTION: ${tool.description}
CATEGORY: ${tool.category}
HANDLER TYPE: ${tool.handler.type}
SUCCESS RATE: ${(report.successRate * 100).toFixed(1)}%
USAGE COUNT: ${report.usageCount}
ISSUES: ${report.issues.join(', ')}
${failureContext}

Respond with JSON:
{
    "type": "PROMPT|PARAMS|HANDLER|DEPRECATE",
    "description": "What should be changed",
    "implementation": "Specific code or prompt changes",
    "priority": "HIGH|MEDIUM|LOW",
    "confidence": 0.0-1.0
}`;

        try {
            const response = await backgroundLLM.generate(prompt, {
                taskType: 'CODE',
                priority: 'LOW'
            });

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const parsed = JSON.parse(jsonMatch[0]);

            return {
                toolName,
                type: parsed.type || 'PROMPT',
                description: parsed.description || 'No description',
                implementation: parsed.implementation || '',
                priority: parsed.priority || 'MEDIUM',
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5))
            };

        } catch (error: any) {
            console.error(`[TOOL_EVOLVER] Failed to generate suggestion:`, error.message);
            return null;
        }
    }

    /**
     * Run a full evolution cycle
     */
    public async runEvolutionCycle(maxSuggestions: number = 3): Promise<EvolutionCycleResult> {
        console.log('[TOOL_EVOLVER] 🔄 Starting evolution cycle...');

        const reports = await this.analyzeAllTools();
        const lowPerformers = reports.filter(r => r.needsOptimization);

        const suggestions: EvolutionSuggestion[] = [];

        // Generate suggestions for worst performers
        for (const report of lowPerformers.slice(0, maxSuggestions)) {
            const suggestion = await this.suggestEvolution(report.name);
            if (suggestion) {
                suggestions.push(suggestion);
            }
        }

        const result: EvolutionCycleResult = {
            timestamp: Date.now(),
            toolsAnalyzed: reports.length,
            lowPerformers: lowPerformers.length,
            suggestionsGenerated: suggestions.length,
            suggestions
        };

        // Emit event for UI
        systemBus.emit(SystemProtocol.TOOL_EVOLUTION, result, 'TOOL_EVOLVER');

        console.log(`[TOOL_EVOLVER] ✅ Cycle complete: ${suggestions.length} suggestions generated`);

        return result;
    }

    /**
     * Schedule periodic evolution cycles
     */
    public scheduleEvolutionCycles(intervalMs: number = 6 * 60 * 60 * 1000): void {
        console.log(`[TOOL_EVOLVER] ⏰ Scheduled evolution every ${intervalMs / 3600000}h`);

        setInterval(async () => {
            console.log('[TOOL_EVOLVER] ⏰ Running scheduled evolution cycle...');
            await this.runEvolutionCycle();
        }, intervalMs);
    }

    /**
     * Get performance summary
     */
    public async getPerformanceSummary(): Promise<{
        totalTools: number;
        healthyTools: number;
        needsAttention: number;
        avgSuccessRate: number;
    }> {
        const reports = await this.analyzeAllTools();

        const healthyTools = reports.filter(r => !r.needsOptimization).length;
        const needsAttention = reports.filter(r => r.needsOptimization).length;

        const avgSuccessRate = reports.length > 0
            ? reports.reduce((sum, r) => sum + r.successRate, 0) / reports.length
            : 1;

        return {
            totalTools: reports.length,
            healthyTools,
            needsAttention,
            avgSuccessRate
        };
    }
}

export const toolEvolver = ToolEvolver.getInstance();
