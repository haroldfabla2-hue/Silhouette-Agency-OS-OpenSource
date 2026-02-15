/**
 * FIGURE GENERATOR SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Generates figures, charts, and diagrams for academic papers.
 * Uses ImageFactory for conceptual diagrams and Mermaid for flowcharts.
 * Coordinates GPU usage with Ollama to prevent saturation.
 */

import { imageFactory } from './media/imageFactory';
import { Figure, Table } from './paperGenerator';
import { SynthesizedInsight } from './synthesisService';
import { resourceArbiter } from './resourceArbiter';
import { ollamaService } from './ollamaService';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ChartData {
    title: string;
    type: 'bar' | 'line' | 'pie' | 'scatter';
    labels: string[];
    datasets: {
        label: string;
        data: number[];
        color?: string;
    }[];
}

export interface DiagramSpec {
    type: 'flowchart' | 'sequence' | 'class' | 'er' | 'mindmap';
    title: string;
    code: string;
}

export interface ComparisonItem {
    name: string;
    attributes: Record<string, string | number>;
}

// ═══════════════════════════════════════════════════════════════
// FIGURE GENERATOR
// ═══════════════════════════════════════════════════════════════

class FigureGenerator {
    private outputDir: string;
    private figureCount: number = 0;
    private gpuAcquired: boolean = false;

    constructor() {
        this.outputDir = path.join(process.cwd(), 'output', 'figures');
    }

    /**
     * GPU COORDINATION: Prepare GPU for image generation
     * Unloads Ollama model if VRAM is high
     */
    private async prepareGpuForImageGen(): Promise<void> {
        try {
            const metrics = await resourceArbiter.getRealMetrics();
            const vramUsagePercent = (metrics.vramUsed / metrics.vramTotal) * 100;

            console.log(`[FIGURES] 🔍 GPU Status: ${vramUsagePercent.toFixed(1)}% VRAM used`);

            // If VRAM is >50% used, unload Ollama to free space
            if (vramUsagePercent > 50) {
                console.log(`[FIGURES] 📉 Unloading Ollama models to free GPU...`);
                await ollamaService.unloadModel('llama3.2:light');
                await ollamaService.unloadModel('glm4:light');
                await this.delay(2000); // Wait for VRAM to free

                // Verify
                const newMetrics = await resourceArbiter.getRealMetrics();
                console.log(`[FIGURES] ✅ VRAM now: ${((newMetrics.vramUsed / newMetrics.vramTotal) * 100).toFixed(1)}%`);
            }

            this.gpuAcquired = true;
        } catch (error) {
            console.warn('[FIGURES] ⚠️ GPU prep failed, continuing anyway:', error);
        }
    }

    /**
     * GPU COORDINATION: Release GPU after generation
     */
    private releaseGpu(): void {
        if (this.gpuAcquired) {
            resourceArbiter.release();
            this.gpuAcquired = false;
            console.log(`[FIGURES] 🔓 GPU released`);
        }
    }

    /**
     * Delay helper
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Generate all figures for a paper
     * Uses GPU coordination to prevent conflicts with Ollama
     */
    async generateFiguresForPaper(insight: SynthesizedInsight): Promise<Figure[]> {
        console.log(`[FIGURES] 🎨 Generating figures for: "${insight.title}"`);
        await fs.mkdir(this.outputDir, { recursive: true });

        const figures: Figure[] = [];

        try {
            // STEP 1: Prepare GPU (unload Ollama if needed)
            await this.prepareGpuForImageGen();

            // 1. Concept diagram (methodology overview)
            const conceptFig = await this.generateConceptDiagram(
                `Scientific methodology diagram showing ${insight.domain} research approach with hypothesis testing and validation`,
                'Research Methodology Overview'
            );
            if (conceptFig) figures.push(conceptFig);

            // 2. Relationship diagram (discoveries) - now as PNG
            if (insight.discoveries.length >= 3) {
                const relationFig = await this.generateRelationshipDiagram(insight);
                if (relationFig) figures.push(relationFig);
            }

            // 3. Pattern analysis chart - now as PNG
            if (insight.patterns.length >= 2) {
                const patternFig = await this.generatePatternChart(insight);
                if (patternFig) figures.push(patternFig);
            }

            console.log(`[FIGURES] ✅ Generated ${figures.length} figures`);
        } finally {
            // STEP FINAL: Release GPU
            this.releaseGpu();
        }

        return figures;
    }

    /**
     * Generate conceptual diagram using AI image generation
     * GPU is already prepared by generateFiguresForPaper
     */
    async generateConceptDiagram(description: string, caption: string): Promise<Figure | null> {
        try {
            console.log(`[FIGURES] 🖼️ Generating concept diagram via NanoBanana: "${caption}"`);

            const asset = await imageFactory.createAsset({
                prompt: `Scientific diagram, clean professional style, academic paper figure, white background, technical illustration: ${description}`,
                style: 'ILLUSTRATION',
                aspectRatio: '16:9',
                saveToLibrary: true
            });

            if (!asset) {
                console.warn(`[FIGURES] ⚠️ Failed to generate concept diagram`);
                return null;
            }

            this.figureCount++;
            return {
                id: `fig_${Date.now()}_${this.figureCount}`,
                caption,
                filePath: asset.localPath || asset.url,
                type: 'concept',
                order: this.figureCount,
                altText: description
            };
        } catch (error) {
            console.error('[FIGURES] Error generating concept diagram:', error);
            return null;
        }
    }

    /**
     * Render Mermaid diagram to PNG
     * Requires @mermaid-js/mermaid-cli installed globally or via npx
     */
    private async renderMermaidToPng(mermaidPath: string): Promise<string | null> {
        try {
            const pngPath = mermaidPath.replace('.mmd', '.png');
            console.log(`[FIGURES] 🔄 Rendering Mermaid to PNG: ${path.basename(mermaidPath)}`);

            await execAsync(`npx -y @mermaid-js/mermaid-cli -i "${mermaidPath}" -o "${pngPath}" -b transparent`);

            // Verify file was created
            try {
                await fs.access(pngPath);
                console.log(`[FIGURES] ✅ PNG created: ${path.basename(pngPath)}`);
                return pngPath;
            } catch {
                console.warn(`[FIGURES] ⚠️ PNG not found after render`);
                return null;
            }
        } catch (error) {
            console.warn(`[FIGURES] ⚠️ Mermaid render failed:`, error);
            return mermaidPath; // Return .mmd file as fallback
        }
    }

    /**
     * Generate Mermaid diagram - renders to PNG for paper inclusion
     */
    async generateMermaidDiagram(spec: DiagramSpec): Promise<Figure | null> {
        try {
            console.log(`[FIGURES] 📊 Generating Mermaid ${spec.type}: "${spec.title}"`);

            const figureId = `fig_mermaid_${Date.now()}`;
            const mermaidPath = path.join(this.outputDir, `${figureId}.mmd`);

            // Save Mermaid code to file
            await fs.writeFile(mermaidPath, spec.code, 'utf-8');

            // Render to PNG
            const pngPath = await this.renderMermaidToPng(mermaidPath);
            const finalPath = pngPath || mermaidPath;

            this.figureCount++;
            return {
                id: figureId,
                caption: spec.title,
                filePath: finalPath,
                type: 'diagram',
                order: this.figureCount,
                altText: `${spec.type} diagram: ${spec.title}`
            };
        } catch (error) {
            console.error('[FIGURES] Error generating Mermaid diagram:', error);
            return null;
        }
    }

    /**
     * Generate relationship diagram from discoveries
     */
    private async generateRelationshipDiagram(insight: SynthesizedInsight): Promise<Figure | null> {
        // Create Mermaid flowchart from discoveries
        const nodes = new Set<string>();
        const edges: string[] = [];

        for (const discovery of insight.discoveries.slice(0, 10)) {
            const source = this.sanitizeNodeName(discovery.sourceNode);
            const target = this.sanitizeNodeName(discovery.targetNode);
            nodes.add(source);
            nodes.add(target);

            const relation = discovery.relationType || 'relates_to';
            edges.push(`    ${source} -->|${relation}| ${target}`);
        }

        const mermaidCode = `flowchart LR
${edges.join('\n')}`;

        return this.generateMermaidDiagram({
            type: 'flowchart',
            title: 'Knowledge Graph: Discovered Relationships',
            code: mermaidCode
        });
    }

    /**
     * Generate pattern analysis chart
     */
    private async generatePatternChart(insight: SynthesizedInsight): Promise<Figure | null> {
        // Create a simple bar chart representation as Mermaid
        const patternData = insight.patterns.slice(0, 5).map((p, i) => ({
            label: `P${i + 1}`,
            value: Math.round((insight.discoveries.length / (i + 1)) * 10)
        }));

        const mermaidCode = `pie title Pattern Distribution
${patternData.map(p => `    "${p.label}" : ${p.value}`).join('\n')}`;

        return this.generateMermaidDiagram({
            type: 'flowchart',
            title: `Pattern Analysis: ${insight.patterns.length} Patterns Identified`,
            code: mermaidCode
        });
    }

    /**
     * Generate data chart (bar, line, pie)
     */
    async generateChart(data: ChartData): Promise<Figure | null> {
        try {
            console.log(`[FIGURES] 📈 Generating ${data.type} chart: "${data.title}"`);

            let mermaidCode: string;

            if (data.type === 'pie') {
                mermaidCode = `pie title ${data.title}
${data.labels.map((label, i) => `    "${label}" : ${data.datasets[0].data[i]}`).join('\n')}`;
            } else {
                // For bar/line/scatter, use xychart
                mermaidCode = `xychart-beta
    title "${data.title}"
    x-axis [${data.labels.map(l => `"${l}"`).join(', ')}]
    y-axis "Value"
    bar [${data.datasets[0].data.join(', ')}]`;
            }

            return this.generateMermaidDiagram({
                type: 'flowchart',
                title: data.title,
                code: mermaidCode
            });
        } catch (error) {
            console.error('[FIGURES] Error generating chart:', error);
            return null;
        }
    }

    /**
     * Generate comparison table
     */
    async generateComparisonTable(items: ComparisonItem[], title: string): Promise<Table> {
        const allAttributes = new Set<string>();
        items.forEach(item => {
            Object.keys(item.attributes).forEach(attr => allAttributes.add(attr));
        });

        const headers = ['Item', ...Array.from(allAttributes)];
        const rows = items.map(item => [
            item.name,
            ...Array.from(allAttributes).map(attr =>
                String(item.attributes[attr] ?? '-')
            )
        ]);

        return {
            id: `table_${Date.now()}`,
            caption: title,
            headers,
            rows,
            order: 1
        };
    }

    /**
     * Generate methodology table
     */
    generateMethodologyTable(
        dataSources: { name: string; url: string; accessDate: string }[],
        tools: string[]
    ): Table {
        return {
            id: `table_methodology_${Date.now()}`,
            caption: 'Data Sources and Analysis Tools',
            headers: ['Category', 'Name', 'Details'],
            rows: [
                ...dataSources.map(ds => ['Data Source', ds.name, `Accessed: ${ds.accessDate}`]),
                ...tools.map(tool => ['Analysis Tool', tool, '-'])
            ],
            order: 1
        };
    }

    /**
     * Sanitize node name for Mermaid
     */
    private sanitizeNodeName(name: string): string {
        return name
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .replace(/__+/g, '_')
            .slice(0, 30);
    }

    /**
     * Get figure count
     */
    getFigureCount(): number {
        return this.figureCount;
    }

    /**
     * Reset figure counter (for new paper)
     */
    resetCounter(): void {
        this.figureCount = 0;
    }
}

export const figureGenerator = new FigureGenerator();
