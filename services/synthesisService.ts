/**
 * SYNTHESIS SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Combines multiple discoveries into coherent insights.
 * Identifies patterns, formulates hypotheses, and prepares content for papers.
 * NOW WITH SQLite PERSISTENCE
 */

import { generateText } from './geminiService';
import { discoveryJournal } from './discoveryJournal';
import { conductResearch, AcademicPaper, SearchResult } from './researchTools';
import { sqliteService } from './sqliteService';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface Discovery {
    sourceNode: string;
    targetNode: string;
    relationType: string;
    confidence: number;
    feedback: string;
    timestamp: number;
}

export interface SynthesizedInsight {
    id: string;
    title: string;
    summary: string;
    discoveries: Discovery[];
    patterns: string[];
    novelHypothesis: string;
    supportingEvidence: {
        webSources: SearchResult[];
        academicPapers: AcademicPaper[];
    };
    confidence: number;
    createdAt: number;
    domain: string;
}

export interface SynthesisRequest {
    discoveries?: Discovery[];
    domain?: string;
    minDiscoveries?: number;
    includeResearch?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// SYNTHESIS ENGINE
// ═══════════════════════════════════════════════════════════════

class SynthesisService {
    private insights: Map<string, SynthesizedInsight> = new Map();

    /**
     * Synthesize insights from recent discoveries
     */
    async synthesizeFromRecent(options: SynthesisRequest = {}): Promise<SynthesizedInsight | null> {
        const {
            minDiscoveries = 3,
            domain,
            includeResearch = true
        } = options;

        // 1. Get recent accepted discoveries from journal
        const recentDiscoveries = await this.getRecentDiscoveries(minDiscoveries, domain);

        if (recentDiscoveries.length < minDiscoveries) {
            console.log(`[SYNTHESIS] ⚠️ Not enough discoveries (${recentDiscoveries.length}/${minDiscoveries})`);
            return null;
        }

        console.log(`[SYNTHESIS] 🧬 Synthesizing from ${recentDiscoveries.length} discoveries...`);

        // 2. Identify patterns
        const patterns = await this.identifyPatterns(recentDiscoveries);

        // 3. Formulate novel hypothesis
        const hypothesis = await this.formulateHypothesis(recentDiscoveries, patterns);

        // 4. Gather supporting evidence (optional)
        let evidence = { webSources: [] as SearchResult[], academicPapers: [] as AcademicPaper[] };
        if (includeResearch && hypothesis) {
            evidence = await this.gatherEvidence(hypothesis);
        }

        // 5. Generate insight summary
        const insight = await this.generateInsight(recentDiscoveries, patterns, hypothesis, evidence);

        if (insight) {
            this.insights.set(insight.id, insight);
            this.saveInsight(insight); // Persist to SQLite
            console.log(`[SYNTHESIS] ✅ Insight created: "${insight.title}"`);
        }

        return insight;
    }

    /**
     * Get recent accepted discoveries from journal
     */
    private async getRecentDiscoveries(limit: number, domain?: string): Promise<Discovery[]> {
        const recentEntries = discoveryJournal.getRecentDiscoveries(limit * 2); // Get extra to filter

        // mapRowToEntry already converts to camelCase (sourceNode, targetNode, finalOutcome, etc.)
        return recentEntries
            .filter(entry => entry.finalOutcome === 'ACCEPTED')
            .slice(0, limit)
            .map(entry => ({
                sourceNode: entry.sourceNode,
                targetNode: entry.targetNode,
                relationType: entry.relationType || 'RELATED_TO',
                confidence: entry.confidence,
                feedback: entry.feedback || '',
                timestamp: entry.timestamp
            }));
    }

    /**
     * Identify patterns across discoveries
     */
    private async identifyPatterns(discoveries: Discovery[]): Promise<string[]> {
        const discoveryList = discoveries.map(d =>
            `- ${d.sourceNode} → ${d.targetNode} (${d.relationType}): ${d.feedback}`
        ).join('\n');

        const prompt = `Analyze these knowledge discoveries and identify 2-3 key patterns or themes:

DISCOVERIES:
${discoveryList}

List the patterns as brief, insightful statements. Focus on:
1. Cross-domain connections
2. Recurring concepts or mechanisms
3. Novel relationships

Format: One pattern per line, starting with "•"`;

        const response = await generateText(prompt);

        if (!response) return [];

        return response
            .split('\n')
            .filter(line => line.trim().startsWith('•') || line.trim().startsWith('-'))
            .map(line => line.replace(/^[•\-]\s*/, '').trim())
            .filter(line => line.length > 10);
    }

    /**
     * Formulate a novel hypothesis from patterns
     */
    private async formulateHypothesis(discoveries: Discovery[], patterns: string[]): Promise<string> {
        const patternList = patterns.map(p => `• ${p}`).join('\n');
        const concepts = [...new Set([
            ...discoveries.map(d => d.sourceNode),
            ...discoveries.map(d => d.targetNode)
        ])].join(', ');

        const prompt = `Based on these patterns and concepts, formulate ONE novel, testable hypothesis:

PATTERNS:
${patternList}

CONCEPTS INVOLVED: ${concepts}

Generate a hypothesis that:
1. Connects multiple concepts in a novel way
2. Is specific and testable
3. Has potential scientific value

Format: "If [condition], then [prediction], because [mechanism]"`;

        const response = await generateText(prompt);
        return response || '';
    }

    /**
     * Gather supporting evidence for hypothesis
     */
    private async gatherEvidence(hypothesis: string): Promise<{
        webSources: SearchResult[];
        academicPapers: AcademicPaper[];
    }> {
        console.log(`[SYNTHESIS] 🔍 Gathering evidence for: "${hypothesis.substring(0, 50)}..."`);

        const research = await conductResearch(hypothesis, {
            web: true,
            academic: true,
            maxResults: 3
        });

        return {
            webSources: research.webResults,
            academicPapers: research.academicPapers
        };
    }

    /**
     * Generate final insight summary
     */
    private async generateInsight(
        discoveries: Discovery[],
        patterns: string[],
        hypothesis: string,
        evidence: { webSources: SearchResult[]; academicPapers: AcademicPaper[] }
    ): Promise<SynthesizedInsight | null> {
        const prompt = `Create a title and summary for this scientific insight:

HYPOTHESIS: ${hypothesis}

PATTERNS IDENTIFIED:
${patterns.map(p => `• ${p}`).join('\n')}

SUPPORTING EVIDENCE:
- ${evidence.webSources.length} web sources
- ${evidence.academicPapers.length} academic papers

Generate:
1. A concise, compelling title (10 words max)
2. A 2-3 sentence summary suitable for an abstract

Format:
TITLE: [your title]
SUMMARY: [your summary]`;

        const response = await generateText(prompt);

        if (!response) return null;

        const titleMatch = response.match(/TITLE:\s*(.+)/i);
        const summaryMatch = response.match(/SUMMARY:\s*(.+)/is);

        const title = titleMatch ? titleMatch[1].trim() : 'Untitled Insight';
        const summary = summaryMatch ? summaryMatch[1].trim() : hypothesis;

        // Determine domain from most common concept prefix
        const allConcepts = discoveries.flatMap(d => [d.sourceNode, d.targetNode]);
        const domain = this.inferDomain(allConcepts);

        return {
            id: `insight_${Date.now()}`,
            title,
            summary,
            discoveries,
            patterns,
            novelHypothesis: hypothesis,
            supportingEvidence: evidence,
            confidence: this.calculateConfidence(discoveries, evidence),
            createdAt: Date.now(),
            domain
        };
    }

    /**
     * Infer domain from concept names
     */
    private inferDomain(concepts: string[]): string {
        const domainKeywords: Record<string, string[]> = {
            'biology': ['dna', 'cell', 'protein', 'gene', 'evolution', 'organism'],
            'technology': ['blockchain', 'ai', 'algorithm', 'network', 'computer', 'data'],
            'philosophy': ['consciousness', 'ethics', 'existence', 'knowledge', 'truth'],
            'physics': ['quantum', 'particle', 'energy', 'wave', 'relativity'],
            'interdisciplinary': []
        };

        const lowerConcepts = concepts.map(c => c.toLowerCase());

        for (const [domain, keywords] of Object.entries(domainKeywords)) {
            if (keywords.some(kw => lowerConcepts.some(c => c.includes(kw)))) {
                return domain;
            }
        }

        return 'interdisciplinary';
    }

    /**
     * Calculate confidence based on evidence
     */
    /**
     * Calculate confidence based on evidence
     */
    private calculateConfidence(
        discoveries: Discovery[],
        evidence: { webSources: SearchResult[]; academicPapers: AcademicPaper[] }
    ): number {
        const avgDiscoveryConfidence = discoveries.reduce((sum, d) => sum + d.confidence, 0) / discoveries.length;
        const evidenceBonus = Math.min(0.2, (evidence.webSources.length + evidence.academicPapers.length * 2) * 0.02);

        return Math.min(0.95, avgDiscoveryConfidence + evidenceBonus);
    }

    // ═══════════════════════════════════════════════════════════════
    // PERSISTENCE LAYER (SQLite)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Save insight to SQLite
     */
    private saveInsight(insight: SynthesizedInsight): void {
        try {
            const db = (sqliteService as any).db;
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO synthesized_insights 
                (id, title, summary, discoveries, patterns, novel_hypothesis, 
                 supporting_evidence, confidence, domain, created_at, paper_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                insight.id,
                insight.title,
                insight.summary,
                JSON.stringify(insight.discoveries),
                JSON.stringify(insight.patterns),
                insight.novelHypothesis,
                JSON.stringify(insight.supportingEvidence),
                insight.confidence,
                insight.domain,
                insight.createdAt,
                null
            );
            console.log(`[SYNTHESIS] 💾 Insight persisted: ${insight.id}`);
        } catch (error) {
            console.error('[SYNTHESIS] Failed to persist insight:', error);
        }
    }

    /**
     * Load all insights from SQLite
     */
    loadFromDatabase(): void {
        try {
            const db = (sqliteService as any).db;
            const rows = db.prepare(`SELECT * FROM synthesized_insights ORDER BY created_at DESC`).all();

            for (const row of rows) {
                const insight: SynthesizedInsight = {
                    id: row.id,
                    title: row.title,
                    summary: row.summary,
                    discoveries: JSON.parse(row.discoveries || '[]'),
                    patterns: JSON.parse(row.patterns || '[]'),
                    novelHypothesis: row.novel_hypothesis,
                    supportingEvidence: JSON.parse(row.supporting_evidence || '{}'),
                    confidence: row.confidence,
                    domain: row.domain,
                    createdAt: row.created_at
                };
                this.insights.set(insight.id, insight);
            }
            console.log(`[SYNTHESIS] 📂 Loaded ${rows.length} insights from database`);
        } catch (error) {
            console.error('[SYNTHESIS] Failed to load insights:', error);
        }
    }

    /**
     * Get all synthesized insights (from memory + database)
     */
    getInsights(): SynthesizedInsight[] {
        return Array.from(this.insights.values());
    }

    /**
     * Get insight by ID (checks memory first, then database)
     */
    getInsight(id: string): SynthesizedInsight | undefined {
        let insight = this.insights.get(id);

        if (!insight) {
            // Try loading from database
            try {
                const db = (sqliteService as any).db;
                const row = db.prepare(`SELECT * FROM synthesized_insights WHERE id = ?`).get(id);
                if (row) {
                    insight = {
                        id: row.id,
                        title: row.title,
                        summary: row.summary,
                        discoveries: JSON.parse(row.discoveries || '[]'),
                        patterns: JSON.parse(row.patterns || '[]'),
                        novelHypothesis: row.novel_hypothesis,
                        supportingEvidence: JSON.parse(row.supporting_evidence || '{}'),
                        confidence: row.confidence,
                        domain: row.domain,
                        createdAt: row.created_at
                    };
                    this.insights.set(id, insight);
                }
            } catch (error) {
                console.error('[SYNTHESIS] Failed to fetch insight from DB:', error);
            }
        }

        return insight;
    }

    /**
     * Get insights ready for paper generation
     */
    getInsightsForPaper(minConfidence: number = 0.7): SynthesizedInsight[] {
        return this.getInsights()
            .filter(i => i.confidence >= minConfidence)
            .sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Get insight statistics
     */
    getStats(): { total: number; byDomain: Record<string, number>; avgConfidence: number } {
        const insights = this.getInsights();
        const byDomain: Record<string, number> = {};

        for (const i of insights) {
            byDomain[i.domain] = (byDomain[i.domain] || 0) + 1;
        }

        return {
            total: insights.length,
            byDomain,
            avgConfidence: insights.length > 0
                ? insights.reduce((sum, i) => sum + i.confidence, 0) / insights.length
                : 0
        };
    }

    /**
     * Link paper to insight
     */
    linkPaper(insightId: string, paperId: string): void {
        try {
            const db = (sqliteService as any).db;
            db.prepare(`UPDATE synthesized_insights SET paper_id = ? WHERE id = ?`).run(paperId, insightId);
            console.log(`[SYNTHESIS] 🔗 Linked paper ${paperId} to insight ${insightId}`);
        } catch (error) {
            console.error('[SYNTHESIS] Failed to link paper:', error);
        }
    }
}

export const synthesisService = new SynthesisService();

// Load existing insights on module init
try {
    synthesisService.loadFromDatabase();
} catch (e) {
    // Database might not be ready yet during first import
}
