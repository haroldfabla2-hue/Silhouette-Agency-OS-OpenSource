/**
 * PAPER GENERATION SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Generates professional academic papers from synthesized insights.
 * Supports multiple formats: Markdown, LaTeX, and structured JSON.
 */

import { generateText } from './geminiService';
import { synthesisService, SynthesizedInsight } from './synthesisService';
import { generateCitation, AcademicPaper } from './researchTools';
import { sqliteService } from './sqliteService';
import * as fs from 'fs/promises';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════
// TYPES - Publication Quality Paper Structures
// ═══════════════════════════════════════════════════════════════

export interface Author {
    name: string;
    email?: string;
    orcid?: string;
    affiliation: string;
    isCorresponding?: boolean;
}

export interface Figure {
    id: string;
    caption: string;
    filePath: string;
    type: 'concept' | 'chart' | 'diagram' | 'photo';
    order: number;
    altText?: string;
}

export interface Table {
    id: string;
    caption: string;
    headers: string[];
    rows: string[][];
    order: number;
}

export interface DefinedMetric {
    name: string;
    definition: string;
    formula?: string;
    unit?: string;
    range?: { min: number; max: number };
}

export interface MethodologySection {
    approach: string;
    dataCollection: string;
    dataSources: { name: string; url: string; accessDate: string }[];
    analysisMethod: string;
    tools: string[];
    limitations: string[];
}

export interface AcademicReference {
    id: string;
    authors: string[];
    title: string;
    journal?: string;
    year: number;
    volume?: string;
    pages?: string;
    doi?: string;
    url?: string;
    citationText: string;
    verified: boolean;
}

export interface RevisionEntry {
    version: string;
    date: string;
    changes: string;
}

export interface PeerReviewScore {
    methodology: number;      // 1-10
    evidenceQuality: number;  // 1-10
    novelty: number;          // 1-10
    clarity: number;          // 1-10
    reproducibility: number;  // 1-10
    references: number;       // 1-10
}

export interface PeerReviewResult {
    scores: PeerReviewScore;
    overallScore: number;
    verdict: 'ACCEPT' | 'MINOR_REVISIONS' | 'MAJOR_REVISIONS' | 'REJECT';
    missingElements: string[];
    suggestions: string[];
    feedback: string;
}

// Legacy interface for backward compatibility
export interface PaperSection {
    title: string;
    content: string;
    order: number;
}

// Legacy interface for backward compatibility
export interface GeneratedPaper {
    id: string;
    title: string;
    authors: string[];
    abstract: string;
    sections: PaperSection[];
    references: string[];
    keywords: string[];
    insightId: string;
    format: 'markdown' | 'latex' | 'json';
    status: 'draft' | 'reviewed' | 'approved' | 'published';
    peerReviewFeedback?: string;
    createdAt: number;
    updatedAt: number;
}

// New rigorous paper interface
export interface RigorousPaper {
    // Identity & Traceability
    id: string;
    doi?: string;
    version: string;
    revisionHistory: RevisionEntry[];

    // Authors
    authors: Author[];

    // Content
    title: string;
    abstract: string;
    keywords: string[];
    sections: PaperSection[];

    // Methodology (explicit, reproducible)
    methodology: MethodologySection;

    // Figures & Tables
    figures: Figure[];
    tables: Table[];

    // Metrics (defined, not vague)
    metrics: DefinedMetric[];

    // References (REAL, verified)
    references: AcademicReference[];

    // Peer Review
    peerReview?: PeerReviewResult;

    // Compliance
    ethicsStatement?: string;
    dataAvailability: string;
    codeAvailability?: string;

    // Meta
    format: 'markdown' | 'latex' | 'json';
    status: 'draft' | 'reviewed' | 'minor_revisions' | 'major_revisions' | 'approved' | 'published';
    insightId: string;
    createdAt: number;
    updatedAt: number;
    filePath?: string;
}

export interface PaperGenerationOptions {
    format?: 'markdown' | 'latex' | 'json';
    authors?: Author[];
    includeMethodology?: boolean;
    targetJournal?: string;
    wordLimit?: number;
    minReferences?: number;
    generateFigures?: boolean;
    rigorousMode?: boolean;  // Use RigorousPaper pipeline
}

// ═══════════════════════════════════════════════════════════════
// PAPER TEMPLATES
// ═══════════════════════════════════════════════════════════════

const MARKDOWN_TEMPLATE = `# {title}

**Authors:** {authors}

**Keywords:** {keywords}

---

## Abstract

{abstract}

---

## 1. Introduction

{introduction}

## 2. Background

{background}

## 3. Methodology

{methodology}

## 4. Findings

{findings}

## 5. Discussion

{discussion}

## 6. Conclusion

{conclusion}

---

## References

{references}
`;

const LATEX_TEMPLATE = `\\documentclass[12pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{hyperref}
\\usepackage{natbib}

\\title{{title}}
\\author{{authors}}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
{abstract}
\\end{abstract}

\\textbf{Keywords:} {keywords}

\\section{Introduction}
{introduction}

\\section{Background}
{background}

\\section{Methodology}
{methodology}

\\section{Findings}
{findings}

\\section{Discussion}
{discussion}

\\section{Conclusion}
{conclusion}

\\bibliographystyle{plain}
\\begin{thebibliography}{99}
{references}
\\end{thebibliography}

\\end{document}
`;

// ═══════════════════════════════════════════════════════════════
// PAPER GENERATOR
// ═══════════════════════════════════════════════════════════════

class PaperGeneratorService {
    private papers: Map<string, GeneratedPaper> = new Map();
    private outputDir: string;

    constructor() {
        this.outputDir = path.join(process.cwd(), 'output', 'papers');
    }

    /**
     * Generate a paper from an insight
     */
    async generateFromInsight(
        insight: SynthesizedInsight,
        options: PaperGenerationOptions = {}
    ): Promise<GeneratedPaper> {
        const {
            format = 'markdown',
            authors = [{ name: 'Silhouette AI Research', affiliation: 'Silhouette Agency OS' }],
            includeMethodology = true,
            wordLimit = 3000
        } = options;

        // Convert Author[] to string[] for legacy interface
        const authorNames = authors.map(a => typeof a === 'string' ? a : a.name);

        console.log(`[PAPER] 📝 Generating paper from insight: "${insight.title}"`);

        // Generate each section
        const sections = await this.generateSections(insight, includeMethodology);

        // Generate references
        const references = this.formatReferences(insight.supportingEvidence.academicPapers, format);

        // Generate keywords
        const keywords = await this.extractKeywords(insight);

        const paper: GeneratedPaper = {
            id: `paper_${Date.now()}`,
            title: insight.title,
            authors: authorNames,
            abstract: insight.summary,
            sections,
            references,
            keywords,
            insightId: insight.id,
            format,
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.papers.set(paper.id, paper);

        // Save to file
        await this.savePaper(paper);

        console.log(`[PAPER] ✅ Paper generated: ${paper.id}`);
        return paper;
    }

    /**
     * Generate paper sections using LLM
     */
    private async generateSections(
        insight: SynthesizedInsight,
        includeMethodology: boolean
    ): Promise<PaperSection[]> {
        const sections: PaperSection[] = [];

        // Introduction
        sections.push({
            title: 'Introduction',
            content: await this.generateSection('introduction', insight),
            order: 1
        });

        // Background
        sections.push({
            title: 'Background',
            content: await this.generateSection('background', insight),
            order: 2
        });

        // Methodology (optional)
        if (includeMethodology) {
            sections.push({
                title: 'Methodology',
                content: await this.generateSection('methodology', insight),
                order: 3
            });
        }

        // Findings
        sections.push({
            title: 'Findings',
            content: await this.generateSection('findings', insight),
            order: 4
        });

        // Discussion
        sections.push({
            title: 'Discussion',
            content: await this.generateSection('discussion', insight),
            order: 5
        });

        // Conclusion
        sections.push({
            title: 'Conclusion',
            content: await this.generateSection('conclusion', insight),
            order: 6
        });

        return sections;
    }

    /**
     * Generate a specific section
     */
    private async generateSection(
        sectionType: string,
        insight: SynthesizedInsight
    ): Promise<string> {
        const prompts: Record<string, string> = {
            introduction: `Write an academic introduction (2-3 paragraphs) for a research paper about:

TITLE: ${insight.title}
HYPOTHESIS: ${insight.novelHypothesis}
DOMAIN: ${insight.domain}

The introduction should:
1. Establish the importance of the topic
2. Present the research gap
3. State the main hypothesis
4. Briefly outline the paper structure

Write in formal academic style.`,

            background: `Write a background/literature review section (2-3 paragraphs) for:

TOPIC: ${insight.title}
KEY PATTERNS: ${insight.patterns.join('; ')}
RELATED CONCEPTS: ${insight.discoveries.map(d => `${d.sourceNode}, ${d.targetNode}`).join('; ')}

Summarize relevant existing knowledge and establish context.`,

            methodology: `Write a methodology section (1-2 paragraphs) explaining how these insights were derived:

APPROACH: Knowledge graph analysis combined with vector similarity detection
DISCOVERIES ANALYZED: ${insight.discoveries.length} accepted connections
EVIDENCE SOURCES: ${insight.supportingEvidence.webSources.length} web + ${insight.supportingEvidence.academicPapers.length} academic

Describe the computational approach to pattern identification and hypothesis generation.`,

            findings: `Write the findings section (2-3 paragraphs) presenting:

KEY PATTERNS DISCOVERED:
${insight.patterns.map(p => `• ${p}`).join('\n')}

NOVEL HYPOTHESIS:
${insight.novelHypothesis}

CONFIDENCE LEVEL: ${(insight.confidence * 100).toFixed(1)}%

Present the findings objectively with supporting evidence.`,

            discussion: `Write a discussion section (2-3 paragraphs) analyzing:

HYPOTHESIS: ${insight.novelHypothesis}
IMPLICATIONS: Cross-domain connections between ${insight.domain} concepts
LIMITATIONS: Computational analysis, requires empirical validation

Interpret the findings, discuss implications, and acknowledge limitations.`,

            conclusion: `Write a conclusion (1-2 paragraphs) summarizing:

MAIN FINDING: ${insight.title}
HYPOTHESIS: ${insight.novelHypothesis}
FUTURE DIRECTIONS: Empirical testing, broader application

Provide a compelling synthesis and suggest future research directions.`
        };

        const response = await generateText(prompts[sectionType] || `Write section: ${sectionType}`);
        return response || '';
    }

    /**
     * Format references based on format
     */
    private formatReferences(papers: AcademicPaper[], format: 'markdown' | 'latex' | 'json'): string[] {
        if (papers.length === 0) {
            return ['[No external references - original research based on computational knowledge synthesis]'];
        }

        return papers.map((paper, i) => {
            const citation = generateCitation(paper, format === 'latex' ? 'BibTeX' : 'APA');

            if (format === 'markdown') {
                return `[${i + 1}] ${citation.text}`;
            } else if (format === 'latex') {
                return citation.text;
            }
            return citation.text;
        });
    }

    /**
     * Extract keywords from insight
     */
    private async extractKeywords(insight: SynthesizedInsight): Promise<string[]> {
        const concepts = insight.discoveries.flatMap(d => [d.sourceNode, d.targetNode]);
        const uniqueConcepts = [...new Set(concepts)];

        // Add domain as keyword
        return [insight.domain, ...uniqueConcepts.slice(0, 5)];
    }

    /**
     * Run peer review on paper
     */
    async peerReview(paperId: string): Promise<{ approved: boolean; feedback: string }> {
        const paper = this.papers.get(paperId);
        if (!paper) {
            throw new Error(`Paper not found: ${paperId}`);
        }

        console.log(`[PAPER] 🔍 Running peer review on: ${paper.title}`);

        const fullContent = paper.sections.map(s => `## ${s.title}\n${s.content}`).join('\n\n');

        const prompt = `You are a rigorous academic peer reviewer. Review this paper:

TITLE: ${paper.title}
ABSTRACT: ${paper.abstract}

CONTENT:
${fullContent}

Evaluate:
1. Scientific rigor (1-10)
2. Clarity of hypothesis (1-10)
3. Evidence quality (1-10)
4. Novelty (1-10)
5. Writing quality (1-10)

Provide:
- Overall score (average)
- Key strengths (2-3 points)
- Critical issues (if any)
- Recommendation: APPROVE / REVISE / REJECT

Format:
SCORE: [X/10]
RECOMMENDATION: [APPROVE/REVISE/REJECT]
FEEDBACK: [detailed feedback]`;

        const response = await generateText(prompt);

        const scoreMatch = response?.match(/SCORE:\s*(\d+)/i);
        const recommendationMatch = response?.match(/RECOMMENDATION:\s*(\w+)/i);
        const feedbackMatch = response?.match(/FEEDBACK:\s*(.+)/is);

        const score = scoreMatch ? parseInt(scoreMatch[1]) : 5;
        const recommendation = recommendationMatch ? recommendationMatch[1].toUpperCase() : 'REVISE';
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : response || '';

        const approved = recommendation === 'APPROVE' || score >= 7;

        // Update paper status
        paper.status = approved ? 'approved' : 'reviewed';
        paper.peerReviewFeedback = feedback;
        paper.updatedAt = Date.now();

        // Persist updated status to database
        const filePath = path.join(this.outputDir, `${paper.id}.${paper.format === 'latex' ? 'tex' : 'md'}`);
        this.savePaperToDB(paper, filePath);

        console.log(`[PAPER] ${approved ? '✅' : '⚠️'} Peer review: ${recommendation} (${score}/10)`);

        return { approved, feedback };
    }

    /**
     * Save paper to file
     */
    async savePaper(paper: GeneratedPaper): Promise<string> {
        await fs.mkdir(this.outputDir, { recursive: true });

        const filename = `${paper.id}.${paper.format === 'latex' ? 'tex' : 'md'}`;
        const filepath = path.join(this.outputDir, filename);

        let content: string;

        if (paper.format === 'markdown') {
            content = MARKDOWN_TEMPLATE
                .replace('{title}', paper.title)
                .replace('{authors}', paper.authors.join(', '))
                .replace('{keywords}', paper.keywords.join(', '))
                .replace('{abstract}', paper.abstract)
                .replace('{introduction}', paper.sections.find(s => s.title === 'Introduction')?.content || '')
                .replace('{background}', paper.sections.find(s => s.title === 'Background')?.content || '')
                .replace('{methodology}', paper.sections.find(s => s.title === 'Methodology')?.content || '')
                .replace('{findings}', paper.sections.find(s => s.title === 'Findings')?.content || '')
                .replace('{discussion}', paper.sections.find(s => s.title === 'Discussion')?.content || '')
                .replace('{conclusion}', paper.sections.find(s => s.title === 'Conclusion')?.content || '')
                .replace('{references}', paper.references.join('\n\n'));
        } else if (paper.format === 'latex') {
            content = LATEX_TEMPLATE
                .replace('{title}', paper.title)
                .replace('{authors}', paper.authors.join(' \\and '))
                .replace('{keywords}', paper.keywords.join(', '))
                .replace('{abstract}', paper.abstract)
                .replace('{introduction}', paper.sections.find(s => s.title === 'Introduction')?.content || '')
                .replace('{background}', paper.sections.find(s => s.title === 'Background')?.content || '')
                .replace('{methodology}', paper.sections.find(s => s.title === 'Methodology')?.content || '')
                .replace('{findings}', paper.sections.find(s => s.title === 'Findings')?.content || '')
                .replace('{discussion}', paper.sections.find(s => s.title === 'Discussion')?.content || '')
                .replace('{conclusion}', paper.sections.find(s => s.title === 'Conclusion')?.content || '')
                .replace('{references}', paper.references.join('\n\n'));
        } else {
            content = JSON.stringify(paper, null, 2);
        }

        await fs.writeFile(filepath, content, 'utf-8');
        console.log(`[PAPER] 💾 Saved to: ${filepath}`);

        // Also persist to database
        this.savePaperToDB(paper, filepath);

        return filepath;
    }

    /**
     * Get all papers
     */
    getPapers(): GeneratedPaper[] {
        return Array.from(this.papers.values());
    }

    /**
     * Get paper by ID
     */
    getPaper(id: string): GeneratedPaper | undefined {
        return this.papers.get(id);
    }

    /**
     * Full pipeline: Synthesize → Generate → Review
     */
    async fullPipeline(options: PaperGenerationOptions = {}): Promise<GeneratedPaper | null> {
        // 1. Synthesize insights from recent discoveries
        const insight = await synthesisService.synthesizeFromRecent({
            minDiscoveries: 3,
            includeResearch: true
        });

        if (!insight) {
            console.log('[PAPER] ⚠️ No insight available for paper generation');
            return null;
        }

        // 2. Generate paper
        const paper = await this.generateFromInsight(insight, options);

        // 3. Peer review
        await this.peerReview(paper.id);

        // 4. Link paper to insight
        synthesisService.linkPaper(insight.id, paper.id);

        return paper;
    }

    // ═══════════════════════════════════════════════════════════════
    // PERSISTENCE LAYER (SQLite)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Save paper to database
     */
    private savePaperToDB(paper: GeneratedPaper, filePath: string): void {
        try {
            const db = (sqliteService as any).db;
            if (!db) {
                console.warn('[PAPER] Database not initialized, skipping persistence');
                return;
            }
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO generated_papers 
                (id, title, authors, abstract, sections, paper_references, keywords,
                 insight_id, format, status, peer_review_score, peer_review_feedback,
                 file_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            // Extract score from feedback
            const scoreMatch = paper.peerReviewFeedback?.match(/(\d+)\/10/);
            const score = scoreMatch ? parseInt(scoreMatch[1]) : null;

            stmt.run(
                paper.id,
                paper.title,
                JSON.stringify(paper.authors),
                paper.abstract,
                JSON.stringify(paper.sections),
                JSON.stringify(paper.references),
                JSON.stringify(paper.keywords),
                paper.insightId,
                paper.format,
                paper.status,
                score,
                paper.peerReviewFeedback,
                filePath,
                paper.createdAt,
                paper.updatedAt
            );
            console.log(`[PAPER] 💾 Paper persisted to database: ${paper.id}`);
        } catch (error: any) {
            console.error('[PAPER] Failed to persist paper:', error?.message || error);
        }
    }

    /**
     * Load all papers from database
     */
    loadFromDatabase(): void {
        try {
            const db = (sqliteService as any).db;
            if (!db) {
                console.warn('[PAPER] Database not available, skipping load');
                return;
            }
            const rows = db.prepare(`SELECT * FROM generated_papers ORDER BY created_at DESC`).all();

            for (const row of rows) {
                const paper: GeneratedPaper = {
                    id: row.id,
                    title: row.title,
                    authors: JSON.parse(row.authors || '[]'),
                    abstract: row.abstract,
                    sections: JSON.parse(row.sections || '[]'),
                    references: JSON.parse(row.paper_references || '[]'),
                    keywords: JSON.parse(row.keywords || '[]'),
                    insightId: row.insight_id,
                    format: row.format,
                    status: row.status,
                    peerReviewFeedback: row.peer_review_feedback,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };
                this.papers.set(paper.id, paper);
            }
            console.log(`[PAPER] 📂 Loaded ${rows.length} papers from database`);
        } catch (error) {
            console.error('[PAPER] Failed to load papers:', error);
        }
    }

    /**
     * Get paper statistics
     */
    getStats(): { total: number; byStatus: Record<string, number>; avgScore: number } {
        const papers = this.getPapers();
        const byStatus: Record<string, number> = {};
        let totalScore = 0;
        let scoredCount = 0;

        for (const p of papers) {
            byStatus[p.status] = (byStatus[p.status] || 0) + 1;
            const scoreMatch = p.peerReviewFeedback?.match(/(\d+)\/10/);
            if (scoreMatch) {
                totalScore += parseInt(scoreMatch[1]);
                scoredCount++;
            }
        }

        return {
            total: papers.length,
            byStatus,
            avgScore: scoredCount > 0 ? totalScore / scoredCount : 0
        };
    }
}

export const paperGenerator = new PaperGeneratorService();

// Load existing papers on module init
try {
    paperGenerator.loadFromDatabase();
} catch (e) {
    // Database might not be ready yet during first import
}
