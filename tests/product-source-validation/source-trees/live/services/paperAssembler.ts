/**
 * PAPER ASSEMBLER SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Assembles a complete publication-ready paper with embedded assets.
 * Converts figures to base64 for self-contained documents.
 */

import { RigorousPaper, Figure, Table, AcademicReference } from './paperGenerator';
import * as fs from 'fs/promises';
import * as path from 'path';

class PaperAssembler {

    /**
     * Assemble complete paper with embedded images
     */
    async assembleComplete(paper: RigorousPaper): Promise<string> {
        console.log(`[ASSEMBLER] 📄 Assembling complete paper: "${paper.title}"`);

        let content = '';

        // Header
        content += this.generateHeader(paper);

        // Abstract
        content += `\n## Abstract\n\n${paper.abstract}\n\n---\n\n`;

        // Sections
        for (const section of paper.sections) {
            content += `## ${section.order}. ${section.title}\n\n${section.content}\n\n`;
        }

        // Figures (embedded as base64)
        if (paper.figures.length > 0) {
            content += `\n---\n\n## Figures\n\n`;
            for (let i = 0; i < paper.figures.length; i++) {
                const fig = paper.figures[i];
                const embedded = await this.embedFigure(fig, i + 1);
                content += embedded + '\n\n';
            }
        }

        // Tables
        if (paper.tables.length > 0) {
            content += `\n---\n\n## Tables\n\n`;
            for (const table of paper.tables) {
                content += this.formatTable(table) + '\n\n';
            }
        }

        // References
        content += this.generateReferences(paper.references);

        // Footer
        content += this.generateFooter(paper);

        console.log(`[ASSEMBLER] ✅ Paper assembled (${content.length} chars)`);
        return content;
    }

    /**
     * Generate paper header with metadata
     */
    private generateHeader(paper: RigorousPaper): string {
        const authors = paper.authors
            .map(a => `${a.name}${a.orcid ? ` (ORCID: ${a.orcid})` : ''}\n  *${a.affiliation}*${a.isCorresponding ? ' **†**' : ''}`)
            .join('\n\n');

        return `# ${paper.title}

**Version:** ${paper.version} | **DOI:** ${paper.doi || '*pending*'} | **Status:** ${paper.status}

## Authors

${authors}

**† Corresponding Author**

**Keywords:** ${paper.keywords.join(', ')}

---

`;
    }

    /**
     * Embed figure as base64 or reference
     */
    private async embedFigure(figure: Figure, num: number): Promise<string> {
        try {
            if (figure.filePath.startsWith('http')) {
                // URL reference
                return `**Figure ${num}:** ${figure.caption}\n![${figure.altText || figure.caption}](${figure.filePath})`;
            }

            // Check if file exists
            try {
                await fs.access(figure.filePath);
            } catch {
                return `**Figure ${num}:** ${figure.caption}\n*[Image file not found: ${path.basename(figure.filePath)}]*`;
            }

            // Read and embed as base64
            const ext = path.extname(figure.filePath).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

            const imageBuffer = await fs.readFile(figure.filePath);
            const base64 = imageBuffer.toString('base64');

            return `**Figure ${num}:** ${figure.caption}\n![${figure.altText || figure.caption}](data:${mimeType};base64,${base64})`;
        } catch (error) {
            console.warn(`[ASSEMBLER] ⚠️ Could not embed figure: ${figure.caption}`);
            return `**Figure ${num}:** ${figure.caption}\n*[Embedding failed]*`;
        }
    }

    /**
     * Format table as markdown
     */
    private formatTable(table: Table): string {
        const headerRow = `| ${table.headers.join(' | ')} |`;
        const separator = `| ${table.headers.map(() => '---').join(' | ')} |`;
        const dataRows = table.rows.map(row => `| ${row.join(' | ')} |`).join('\n');

        return `**Table:** ${table.caption}\n\n${headerRow}\n${separator}\n${dataRows}`;
    }

    /**
     * Generate references section
     */
    private generateReferences(refs: AcademicReference[]): string {
        let content = `\n---\n\n## References\n\n`;

        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            content += `[${i + 1}] ${ref.citationText}\n`;
            if (ref.doi) content += `    DOI: ${ref.doi}\n`;
            content += '\n';
        }

        return content;
    }

    /**
     * Generate paper footer
     */
    private generateFooter(paper: RigorousPaper): string {
        let content = `\n---\n\n## Data Availability\n\n${paper.dataAvailability}\n`;

        if (paper.codeAvailability) {
            content += `\n**Code Availability:** ${paper.codeAvailability}\n`;
        }

        if (paper.ethicsStatement) {
            content += `\n**Ethics Statement:** ${paper.ethicsStatement}\n`;
        }

        content += `\n---\n\n## Revision History\n\n`;
        for (const rev of paper.revisionHistory) {
            content += `- **v${rev.version}** (${rev.date.split('T')[0]}): ${rev.changes}\n`;
        }

        if (paper.peerReview) {
            content += `\n---\n\n## Peer Review Summary\n\n`;
            content += `**Overall Score:** ${paper.peerReview.overallScore}/10\n`;
            content += `**Verdict:** ${paper.peerReview.verdict}\n\n`;
            content += `| Dimension | Score |\n| --- | --- |\n`;
            content += `| Methodology | ${paper.peerReview.scores.methodology}/10 |\n`;
            content += `| Evidence Quality | ${paper.peerReview.scores.evidenceQuality}/10 |\n`;
            content += `| Novelty | ${paper.peerReview.scores.novelty}/10 |\n`;
            content += `| Clarity | ${paper.peerReview.scores.clarity}/10 |\n`;
            content += `| Reproducibility | ${paper.peerReview.scores.reproducibility}/10 |\n`;
            content += `| References | ${paper.peerReview.scores.references}/10 |\n`;
        }

        content += `\n---\n\n*Generated by Silhouette Agency OS - Publication-Quality Paper Generator*\n`;
        content += `*Generated at: ${new Date().toISOString()}*\n`;

        return content;
    }
}

export const paperAssembler = new PaperAssembler();
