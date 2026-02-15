/**
 * PDF EXPORTER SERVICE v2.0
 * ═══════════════════════════════════════════════════════════════
 * Exports markdown papers to publication-quality PDF documents.
 * Uses marked for proper markdown parsing and Puppeteer for PDF.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { marked } from 'marked';

// Dynamic import for puppeteer
let puppeteer: any = null;

// Configure marked for academic papers
marked.setOptions({
    gfm: true,           // GitHub Flavored Markdown (tables, etc.)
    breaks: false        // No <br> on single newlines
});

class PDFExporter {
    private outputDir: string;

    constructor() {
        this.outputDir = path.join(process.cwd(), 'output', 'papers', 'pdf');
    }

    /**
     * Export markdown file to PDF with proper formatting
     */
    async exportToPDF(markdownPath: string): Promise<string | null> {
        try {
            await fs.mkdir(this.outputDir, { recursive: true });

            // Dynamic import puppeteer
            if (!puppeteer) {
                try {
                    const pup = await import('puppeteer');
                    puppeteer = pup.default || pup;
                } catch (err) {
                    console.warn('[PDF] ⚠️ Puppeteer not installed. Run: npm install puppeteer');
                    return null;
                }
            }

            console.log(`[PDF] 📄 Exporting to PDF: ${path.basename(markdownPath)}`);

            // Read markdown
            const markdown = await fs.readFile(markdownPath, 'utf-8');

            // Pre-process: embed images as base64
            console.log(`[PDF] 🖼️ Processing images...`);
            const processedMarkdown = await this.embedImages(markdown, path.dirname(markdownPath));

            // Convert markdown to HTML using marked
            console.log(`[PDF] 📝 Converting markdown to HTML...`);
            const htmlContent = await marked.parse(processedMarkdown);

            // Wrap in academic template
            const fullHtml = this.wrapInAcademicTemplate(htmlContent);

            // Launch browser and generate PDF
            console.log(`[PDF] 🖨️ Generating PDF...`);
            const browser = await puppeteer.launch({ headless: 'new' });
            const page = await browser.newPage();

            await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

            // Generate PDF
            const pdfPath = path.join(this.outputDir, path.basename(markdownPath).replace('.md', '.pdf'));
            await page.pdf({
                path: pdfPath,
                format: 'A4',
                margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
                printBackground: true,
                displayHeaderFooter: true,
                headerTemplate: '<div></div>',
                footerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
            });

            await browser.close();

            console.log(`[PDF] ✅ PDF created: ${pdfPath}`);
            return pdfPath;
        } catch (error) {
            console.error('[PDF] ❌ Export failed:', error);
            return null;
        }
    }

    /**
     * Export presentation to PDF with themed slide layouts
     */
    async exportPresentation(presentation: {
        id: string;
        title: string;
        theme: string;
        slides: Array<{
            title: string;
            content?: string;
            speakerNotes?: string;
        }>;
    }): Promise<string | null> {
        try {
            await fs.mkdir(this.outputDir, { recursive: true });

            // Dynamic import puppeteer
            if (!puppeteer) {
                try {
                    const pup = await import('puppeteer');
                    puppeteer = pup.default || pup;
                } catch (err) {
                    console.warn('[PDF] ⚠️ Puppeteer not installed. Run: npm install puppeteer');
                    return null;
                }
            }

            console.log(`[PDF] 🎞️ Exporting presentation: ${presentation.title}`);

            // Generate HTML for each slide
            const slidesHtml = presentation.slides.map((slide, idx) => `
                <div class="slide" style="page-break-after: always;">
                    <div class="slide-number">${idx + 1} / ${presentation.slides.length}</div>
                    <div class="slide-content">
                        <h1>${slide.title}</h1>
                        ${slide.content ? `<div class="content">${this.formatSlideContent(slide.content)}</div>` : ''}
                    </div>
                </div>
            `).join('');

            // Generate speaker notes appendix
            const notesHtml = presentation.slides.some(s => s.speakerNotes) ? `
                <div class="notes-appendix">
                    <h2>Speaker Notes</h2>
                    ${presentation.slides.map((slide, idx) => slide.speakerNotes ? `
                        <div class="note-section">
                            <h3>Slide ${idx + 1}: ${slide.title}</h3>
                            <p>${slide.speakerNotes}</p>
                        </div>
                    ` : '').join('')}
                </div>
            ` : '';

            // Wrap in presentation template
            const fullHtml = this.wrapInPresentationTemplate(slidesHtml + notesHtml, presentation.theme);

            // Launch browser and generate PDF
            console.log(`[PDF] 🖨️ Generating PDF slides...`);
            const browser = await puppeteer.launch({ headless: 'new' });
            const page = await browser.newPage();

            await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

            // Generate PDF in landscape for slides
            const safeName = presentation.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
            const pdfPath = path.join(this.outputDir, `presentation_${safeName}.pdf`);
            await page.pdf({
                path: pdfPath,
                format: 'A4',
                landscape: true,
                margin: { top: '0.25in', right: '0.25in', bottom: '0.25in', left: '0.25in' },
                printBackground: true
            });

            await browser.close();

            console.log(`[PDF] ✅ Presentation PDF created: ${pdfPath}`);
            return pdfPath;
        } catch (error) {
            console.error('[PDF] ❌ Presentation export failed:', error);
            return null;
        }
    }

    /**
     * Format slide content (bullets, etc.)
     */
    private formatSlideContent(content: string): string {
        return content.split('\n').map(line => {
            if (line.startsWith('- ')) {
                return `<div class="bullet"><span class="bullet-point">•</span> ${line.substring(2)}</div>`;
            }
            return `<p>${line}</p>`;
        }).join('');
    }

    /**
     * Wrap in presentation template with theme
     */
    private wrapInPresentationTemplate(content: string, theme: string): string {
        const themes: Record<string, { bg: string; text: string; accent: string }> = {
            'modern-dark': { bg: '#0f172a', text: '#f8fafc', accent: '#22d3ee' },
            'corporate': { bg: '#f8fafc', text: '#1e293b', accent: '#2563eb' },
            'pitch-deck': { bg: '#312e81', text: '#ffffff', accent: '#c4b5fd' },
            'academic': { bg: '#fef3c7', text: '#44403c', accent: '#b45309' },
            'minimal': { bg: '#ffffff', text: '#111827', accent: '#6b7280' },
            'creative': { bg: '#ec4899', text: '#ffffff', accent: '#fbbf24' }
        };
        const t = themes[theme] || themes['modern-dark'];

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: ${t.bg};
            color: ${t.text};
        }
        .slide {
            width: 100vw;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 60px 80px;
            position: relative;
        }
        .slide-number {
            position: absolute;
            bottom: 30px;
            right: 40px;
            font-size: 14px;
            opacity: 0.5;
        }
        .slide-content h1 {
            font-size: 48px;
            margin-bottom: 40px;
            color: ${t.accent};
        }
        .content {
            font-size: 24px;
            line-height: 1.6;
        }
        .bullet {
            display: flex;
            align-items: flex-start;
            margin-bottom: 16px;
        }
        .bullet-point {
            color: ${t.accent};
            margin-right: 16px;
            font-size: 28px;
        }
        .notes-appendix {
            page-break-before: always;
            padding: 40px;
        }
        .notes-appendix h2 {
            color: ${t.accent};
            border-bottom: 2px solid ${t.accent};
            padding-bottom: 10px;
        }
        .note-section {
            margin: 20px 0;
            padding: 16px;
            background: rgba(0,0,0,0.05);
            border-radius: 8px;
        }
        .note-section h3 {
            margin: 0 0 8px 0;
            font-size: 16px;
        }
        .note-section p {
            margin: 0;
            font-size: 14px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    ${content}
</body>
</html>`;
    }

    /**
     * Embed images as base64 data URIs
     */
    private async embedImages(markdown: string, basePath: string): Promise<string> {
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let result = markdown;
        let embedCount = 0;

        const matches = [...markdown.matchAll(imageRegex)];

        for (const match of matches) {
            const [fullMatch, alt, imgPath] = match;

            // Skip if already base64
            if (imgPath.startsWith('data:')) continue;

            // Skip URLs
            if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) continue;

            try {
                // Resolve path
                let absolutePath = imgPath;
                if (!path.isAbsolute(imgPath)) {
                    // Try relative to markdown file first
                    absolutePath = path.join(basePath, imgPath);

                    // If not found, try relative to cwd
                    try {
                        await fs.access(absolutePath);
                    } catch {
                        absolutePath = path.join(process.cwd(), imgPath);
                    }
                }

                // Read and encode
                const buffer = await fs.readFile(absolutePath);
                const ext = path.extname(absolutePath).toLowerCase();
                const mimeType = this.getMimeType(ext);
                const base64 = buffer.toString('base64');
                const dataUri = `data:${mimeType};base64,${base64}`;

                // Replace in markdown
                result = result.replace(imgPath, dataUri);
                embedCount++;
                console.log(`[PDF] ✅ Embedded: ${path.basename(absolutePath)}`);
            } catch (err) {
                console.warn(`[PDF] ⚠️ Could not embed image: ${imgPath}`);
            }
        }

        console.log(`[PDF] 📊 Embedded ${embedCount} images`);
        return result;
    }

    /**
     * Get MIME type from extension
     */
    private getMimeType(ext: string): string {
        const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp'
        };
        return mimeTypes[ext] || 'image/png';
    }

    /**
     * Wrap HTML in academic paper template
     */
    private wrapInAcademicTemplate(htmlContent: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        /* Page Setup */
        @page {
            size: A4;
            margin: 0.75in;
        }

        /* Base Typography */
        body {
            font-family: 'Times New Roman', Times, Georgia, serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #1a1a1a;
            max-width: 100%;
            margin: 0;
            padding: 0;
        }

        /* Headings */
        h1 {
            font-size: 18pt;
            font-weight: bold;
            text-align: center;
            margin-bottom: 0.5em;
            page-break-after: avoid;
            line-height: 1.3;
        }

        h2 {
            font-size: 14pt;
            font-weight: bold;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            border-bottom: 2px solid #333;
            padding-bottom: 0.25em;
            page-break-after: avoid;
        }

        h3 {
            font-size: 12pt;
            font-weight: bold;
            margin-top: 1em;
            margin-bottom: 0.5em;
            page-break-after: avoid;
        }

        /* Paragraphs */
        p {
            text-align: justify;
            margin: 0.75em 0;
            text-indent: 0;
        }

        /* Strong and Emphasis */
        strong, b {
            font-weight: bold;
        }

        em, i {
            font-style: italic;
        }

        /* Links */
        a {
            color: #0066cc;
            text-decoration: none;
        }

        /* Lists */
        ul, ol {
            margin: 0.75em 0;
            padding-left: 2em;
        }

        li {
            margin: 0.25em 0;
        }

        /* Tables */
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
            font-size: 10pt;
            page-break-inside: avoid;
        }

        th, td {
            border: 1px solid #333;
            padding: 8px 12px;
            text-align: left;
            vertical-align: top;
        }

        th {
            background-color: #f5f5f5;
            font-weight: bold;
        }

        tr:nth-child(even) {
            background-color: #fafafa;
        }

        /* Images and Figures */
        img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 1em auto;
            page-break-inside: avoid;
        }

        figure {
            text-align: center;
            margin: 1.5em 0;
            page-break-inside: avoid;
        }

        figcaption {
            font-style: italic;
            font-size: 10pt;
            margin-top: 0.5em;
            color: #555;
        }

        /* Code */
        code {
            font-family: 'Courier New', Courier, monospace;
            font-size: 10pt;
            background-color: #f5f5f5;
            padding: 2px 4px;
            border-radius: 3px;
        }

        pre {
            background-color: #f5f5f5;
            padding: 1em;
            overflow-x: auto;
            font-size: 10pt;
            border-radius: 4px;
            page-break-inside: avoid;
        }

        pre code {
            background: none;
            padding: 0;
        }

        /* Blockquotes */
        blockquote {
            border-left: 3px solid #ccc;
            margin: 1em 0;
            padding-left: 1em;
            color: #555;
            font-style: italic;
        }

        /* Horizontal Rules */
        hr {
            border: none;
            border-top: 1px solid #ccc;
            margin: 1.5em 0;
        }

        /* Print Optimization */
        @media print {
            body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
            }

            h1, h2, h3 {
                page-break-after: avoid;
            }

            table, figure, img {
                page-break-inside: avoid;
            }

            a {
                color: #0066cc !important;
            }
        }
    </style>
</head>
<body>
    ${htmlContent}
</body>
</html>`;
    }
}

export const pdfExporter = new PDFExporter();
