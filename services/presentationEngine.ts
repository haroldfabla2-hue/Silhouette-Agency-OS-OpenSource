/**
 * PRESENTATION ENGINE
 * ═══════════════════════════════════════════════════════════════
 * Core service for creating, managing, and rendering presentations.
 * Integrates with LLM for AI-powered slide generation.
 */

import { v4 as uuidv4 } from 'uuid';
import {
    Presentation,
    Slide,
    SlideLayout,
    PresentationTheme,
    PresentationGenerationRequest,
    PresentationOutline,
    ThemeConfig,
    SlideAsset,
    ChartData,
    createSlide,
    createPresentation,
    getThemeConfig,
    THEME_CONFIGS
} from '../types/presentation';

// ═══════════════════════════════════════════════════════════════
// PRESENTATION ENGINE CLASS
// ═══════════════════════════════════════════════════════════════

class PresentationEngine {
    private presentations: Map<string, Presentation> = new Map();

    // ─────────────────────────────────────────────────────────────
    // CRUD Operations
    // ─────────────────────────────────────────────────────────────

    /** Create a new presentation */
    create(title: string, theme: PresentationTheme = 'modern-dark'): Presentation {
        const presentation = createPresentation(title, theme);
        this.presentations.set(presentation.id, presentation);
        console.log(`[PRESENTATION] 📊 Created: "${title}" with theme ${theme}`);
        return presentation;
    }

    /** Get a presentation by ID */
    get(id: string): Presentation | undefined {
        return this.presentations.get(id);
    }

    /** List all presentations */
    list(): Presentation[] {
        return Array.from(this.presentations.values());
    }

    /** Delete a presentation */
    delete(id: string): boolean {
        return this.presentations.delete(id);
    }

    /** Update presentation metadata */
    update(id: string, updates: Partial<Presentation>): Presentation | null {
        const pres = this.presentations.get(id);
        if (!pres) return null;

        const updated = { ...pres, ...updates, updatedAt: Date.now() };
        this.presentations.set(id, updated);
        return updated;
    }

    // ─────────────────────────────────────────────────────────────
    // Slide Management
    // ─────────────────────────────────────────────────────────────

    /** Add a slide to a presentation */
    addSlide(
        presentationId: string,
        slide: Partial<Slide>,
        position?: number
    ): Slide | null {
        const pres = this.presentations.get(presentationId);
        if (!pres) return null;

        const newSlide: Slide = {
            ...createSlide(pres.slides.length),
            ...slide,
            order: position ?? pres.slides.length
        };

        if (position !== undefined && position < pres.slides.length) {
            // Insert at position and reorder
            pres.slides.splice(position, 0, newSlide);
            pres.slides.forEach((s, i) => s.order = i);
        } else {
            pres.slides.push(newSlide);
        }

        pres.updatedAt = Date.now();
        return newSlide;
    }

    /** Update a specific slide */
    updateSlide(
        presentationId: string,
        slideId: string,
        updates: Partial<Slide>
    ): Slide | null {
        const pres = this.presentations.get(presentationId);
        if (!pres) return null;

        const slideIndex = pres.slides.findIndex(s => s.id === slideId);
        if (slideIndex === -1) return null;

        pres.slides[slideIndex] = {
            ...pres.slides[slideIndex],
            ...updates,
            updatedAt: Date.now()
        };

        pres.updatedAt = Date.now();
        return pres.slides[slideIndex];
    }

    /** Delete a slide */
    deleteSlide(presentationId: string, slideId: string): boolean {
        const pres = this.presentations.get(presentationId);
        if (!pres) return false;

        const initialLength = pres.slides.length;
        pres.slides = pres.slides.filter(s => s.id !== slideId);

        // Reorder remaining slides
        pres.slides.forEach((s, i) => s.order = i);
        pres.updatedAt = Date.now();

        return pres.slides.length < initialLength;
    }

    /** Reorder slides */
    reorderSlides(
        presentationId: string,
        fromIndex: number,
        toIndex: number
    ): boolean {
        const pres = this.presentations.get(presentationId);
        if (!pres) return false;

        if (fromIndex < 0 || fromIndex >= pres.slides.length) return false;
        if (toIndex < 0 || toIndex >= pres.slides.length) return false;

        const [slide] = pres.slides.splice(fromIndex, 1);
        pres.slides.splice(toIndex, 0, slide);
        pres.slides.forEach((s, i) => s.order = i);
        pres.updatedAt = Date.now();

        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // AI Generation
    // ─────────────────────────────────────────────────────────────

    /**
     * AUTONOMOUS INTENT ANALYZER
     * Analyzes the user's topic/request to infer what capabilities are needed
     * without explicit user instruction. This enables true autonomy.
     */
    async analyzeIntent(topic: string): Promise<{
        needsResearch: boolean;
        needsImages: boolean;
        needsCharts: boolean;
        suggestedSlideCount: number;
        suggestedTheme: PresentationTheme;
        suggestedStyle: 'formal' | 'casual' | 'technical';
        reasoning: string;
    }> {
        const { geminiService } = await import('./geminiService');

        const prompt = `Analyze this presentation request and determine what capabilities are needed.

REQUEST: "${topic}"

Respond with ONLY valid JSON:
{
    "needsResearch": true/false,  // Does this topic require current information from the web?
    "needsImages": true/false,    // Would visual assets improve this presentation?
    "needsCharts": true/false,    // Does this topic involve data that needs visualization?
    "suggestedSlideCount": 5-15,  // Appropriate number of slides
    "suggestedTheme": "modern-dark|corporate|pitch-deck|academic|minimal|creative",
    "suggestedStyle": "formal|casual|technical",
    "reasoning": "Brief explanation of choices"
}

DECISION RULES:
- needsResearch: TRUE if topic involves current events, statistics, trends, technology, or needs factual backing
- needsImages: TRUE if topic is visual (design, products, places), abstract (concepts, emotions), or benefits from illustrations
- needsCharts: TRUE if topic mentions data, numbers, comparisons, growth, metrics, or statistics
- suggestedTheme: Match to context (startup→pitch-deck, academic→academic, tech→modern-dark, etc.)
- suggestedStyle: formal for business/academic, casual for creative/internal, technical for engineering`;

        try {
            const response = await geminiService.generateText(prompt);
            const jsonMatch = response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('Failed to extract intent JSON');
            }

            const intent = JSON.parse(jsonMatch[0]);
            console.log(`[PRESENTATION] 🧠 Intent Analysis:`, intent.reasoning);

            return {
                needsResearch: intent.needsResearch ?? true,
                needsImages: intent.needsImages ?? false,
                needsCharts: intent.needsCharts ?? false,
                suggestedSlideCount: Math.min(15, Math.max(5, intent.suggestedSlideCount || 7)),
                suggestedTheme: intent.suggestedTheme || 'modern-dark',
                suggestedStyle: intent.suggestedStyle || 'formal',
                reasoning: intent.reasoning || ''
            };
        } catch (e) {
            console.warn('[PRESENTATION] Intent analysis failed, using defaults:', e);
            // Smart defaults based on keywords
            const topicLower = topic.toLowerCase();
            return {
                needsResearch: true,  // Always research by default
                needsImages: /visual|imagen|diseño|producto|logo|marca|interfaz|ui|web/.test(topicLower),
                needsCharts: /data|datos|estadístic|crecimiento|metric|número|porcentaje|ventas/.test(topicLower),
                suggestedSlideCount: 7,
                suggestedTheme: /startup|pitch|inversi/.test(topicLower) ? 'pitch-deck' :
                    /academ|investigación|paper/.test(topicLower) ? 'academic' : 'modern-dark',
                suggestedStyle: 'formal',
                reasoning: 'Default inference from keywords'
            };
        }
    }

    /** Generate a presentation outline using LLM */
    async generateOutline(
        request: PresentationGenerationRequest
    ): Promise<PresentationOutline> {
        const { geminiService } = await import('./geminiService');

        const prompt = `Create a presentation outline for the following topic.

TOPIC: "${request.topic}"
NUMBER OF SLIDES: ${request.numSlides}
AUDIENCE: ${request.targetAudience || 'general'}
STYLE: ${request.style || 'professional'}
LANGUAGE: ${request.language || 'Spanish'}

Return ONLY valid JSON in this exact format:
{
    "title": "Presentation Title",
    "slideOutlines": [
        {
            "title": "Slide Title",
            "keyPoints": ["Point 1", "Point 2", "Point 3"],
            "suggestedLayout": "title|title-content|two-column|full-image|list|quote|chart",
            "needsImage": true
        }
    ]
}

RULES:
- First slide should be a "title" layout with the main topic
- Include a variety of layouts for visual interest
- Last slide should be a conclusion or call-to-action
- Keep titles concise (max 8 words)
- 2-4 key points per slide`;

        try {
            const response = await geminiService.generateText(prompt);
            const jsonMatch = response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('Failed to extract outline JSON');
            }

            return JSON.parse(jsonMatch[0]) as PresentationOutline;
        } catch (e) {
            console.error('[PRESENTATION] Outline generation failed:', e);
            // Return a basic fallback outline
            return this.generateFallbackOutline(request);
        }
    }

    /** Generate fallback outline if LLM fails */
    private generateFallbackOutline(
        request: PresentationGenerationRequest
    ): PresentationOutline {
        const layouts: SlideLayout[] = ['title', 'title-content', 'list', 'two-column', 'title-content'];

        return {
            title: request.topic,
            slideOutlines: Array.from({ length: request.numSlides }, (_, i) => ({
                title: i === 0 ? request.topic : `Sección ${i}`,
                keyPoints: ['Punto clave a desarrollar'],
                suggestedLayout: layouts[i % layouts.length],
                needsImage: i === 0 || i === request.numSlides - 1
            }))
        };
    }

    /** Generate full presentation from request */
    async generate(
        request: PresentationGenerationRequest
    ): Promise<Presentation> {
        console.log(`[PRESENTATION] 🚀 Generating: "${request.topic}"`);

        // 1. Research if needed
        let researchContext = '';
        if (request.includeResearch) {
            try {
                const { researchTools } = await import('./researchTools');
                const searchResults = await researchTools.webSearch(request.topic, 5);
                researchContext = searchResults
                    .map((r: any) => `${r.title}: ${r.snippet}`)
                    .join('\n');
                console.log(`[PRESENTATION] 📚 Research completed`);
            } catch (e) {
                console.warn('[PRESENTATION] Research failed, continuing without:', e);
            }
        }

        // 2. Generate outline
        const outline = await this.generateOutline(request);
        console.log(`[PRESENTATION] 📝 Outline: ${outline.slideOutlines.length} slides`);

        // 3. Create presentation
        const presentation = this.create(outline.title, request.theme);

        // 4. Generate each slide
        for (let i = 0; i < outline.slideOutlines.length; i++) {
            const slideOutline = outline.slideOutlines[i];

            // Generate slide content using LLM
            const slideContent = await this.generateSlideContent(
                slideOutline,
                researchContext,
                request.language || 'Spanish'
            );

            // Generate image if needed
            let slideAssets: SlideAsset[] = [];
            if (request.generateImages && slideOutline.needsImage) {
                try {
                    const { imageFactory } = await import('./media/imageFactory');
                    const imageResult = await imageFactory.createAsset({
                        prompt: `Professional presentation image for: ${slideOutline.title}. Style: clean, modern, minimal background`,
                        style: 'ILLUSTRATION',
                        aspectRatio: '16:9'
                    });

                    if (imageResult && imageResult.url) {
                        slideAssets.push({
                            id: `asset_${Date.now()}`,
                            type: 'image',
                            src: imageResult.url,
                            alt: slideOutline.title,
                            aiGenerated: true,
                            generationPrompt: slideOutline.title
                        });
                    }
                } catch (e) {
                    console.warn(`[PRESENTATION] Image generation failed for slide ${i}:`, e);
                }
            }

            // Skip first slide (already created as title)
            if (i === 0) {
                this.updateSlide(presentation.id, presentation.slides[0].id, {
                    title: slideOutline.title,
                    content: slideContent,
                    layout: slideOutline.suggestedLayout as SlideLayout,
                    assets: slideAssets,
                    aiGenerated: true
                });
            } else {
                this.addSlide(presentation.id, {
                    title: slideOutline.title,
                    content: slideContent,
                    layout: slideOutline.suggestedLayout as SlideLayout,
                    assets: slideAssets,
                    aiGenerated: true
                });
            }

            console.log(`[PRESENTATION] ✅ Slide ${i + 1}/${outline.slideOutlines.length}: ${slideOutline.title}`);
        }

        console.log(`[PRESENTATION] 🎉 Complete: "${presentation.title}" (${presentation.slides.length} slides)`);
        return presentation;
    }

    /**
     * AUTONOMOUS GENERATION
     * Generates a presentation with fully automatic parameter inference.
     * Only requires the topic - everything else is determined by AI analysis.
     */
    async generateAutonomous(
        topic: string,
        overrides?: Partial<PresentationGenerationRequest>
    ): Promise<Presentation> {
        console.log(`[PRESENTATION] 🤖 AUTONOMOUS MODE: "${topic}"`);

        // Step 1: Analyze intent to determine what's needed
        const intent = await this.analyzeIntent(topic);
        console.log(`[PRESENTATION] 📊 Intent Analysis Complete:
            - Research: ${intent.needsResearch}
            - Images: ${intent.needsImages}
            - Charts: ${intent.needsCharts}
            - Slides: ${intent.suggestedSlideCount}
            - Theme: ${intent.suggestedTheme}
            - Reasoning: ${intent.reasoning}`);

        // Step 2: Build request from intent + any overrides
        const request: PresentationGenerationRequest = {
            topic,
            numSlides: overrides?.numSlides ?? intent.suggestedSlideCount,
            theme: overrides?.theme ?? intent.suggestedTheme,
            includeResearch: overrides?.includeResearch ?? intent.needsResearch,
            generateImages: overrides?.generateImages ?? intent.needsImages,
            targetAudience: overrides?.targetAudience,
            style: overrides?.style ?? intent.suggestedStyle,
            language: overrides?.language ?? 'Spanish'
        };

        // Step 3: Generate with inferred parameters
        return this.generate(request);
    }

    /** Generate content for a single slide */
    private async generateSlideContent(
        outline: PresentationOutline['slideOutlines'][0],
        context: string,
        language: string
    ): Promise<string> {
        const { geminiService } = await import('./geminiService');

        const prompt = `Generate slide content in ${language}.

SLIDE TITLE: ${outline.title}
KEY POINTS: ${outline.keyPoints.join(', ')}
LAYOUT: ${outline.suggestedLayout}
${context ? `\nRESEARCH CONTEXT:\n${context.substring(0, 2000)}` : ''}

Return ONLY the slide body content as clean text/markdown.
- For "list" layout: use bullet points
- For "two-column" layout: use two sections with headers
- For "quote" layout: include a relevant quote
- Keep it concise (max 100 words)
- No slide title (already provided)`;

        try {
            const response = await geminiService.generateText(prompt);
            return response.trim();
        } catch (e) {
            return outline.keyPoints.map(p => `• ${p}`).join('\n');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────────────────────────

    /** Render a single slide to TSX code */
    renderSlideToTSX(slide: Slide, theme: ThemeConfig): string {
        const bgStyle = slide.backgroundColor || theme.backgroundColor;
        const textStyle = slide.textColor || theme.textColor;

        // Layout-specific rendering
        switch (slide.layout) {
            case 'title':
                return this.renderTitleSlide(slide, theme);
            case 'two-column':
                return this.renderTwoColumnSlide(slide, theme);
            case 'full-image':
                return this.renderFullImageSlide(slide, theme);
            case 'list':
                return this.renderListSlide(slide, theme);
            case 'quote':
                return this.renderQuoteSlide(slide, theme);
            case 'chart':
                return this.renderChartSlide(slide, theme);
            default:
                return this.renderDefaultSlide(slide, theme);
        }
    }

    private renderTitleSlide(slide: Slide, theme: ThemeConfig): string {
        return `
<div style={{
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '${theme.gradient || theme.backgroundColor}',
    color: '${theme.textColor}',
    textAlign: 'center',
    padding: '4rem'
}}>
    <h1 style={{
        fontSize: '${theme.titleSize}',
        fontFamily: ${JSON.stringify(theme.titleFont)},
        fontWeight: 'bold',
        marginBottom: '1rem'
    }}>${slide.title}</h1>
    ${slide.subtitle ? `<p style={{ fontSize: '1.5rem', opacity: 0.8 }}>${slide.subtitle}</p>` : ''}
    ${slide.content ? `<p style={{ fontSize: '1.25rem', marginTop: '2rem', maxWidth: '600px' }}>${slide.content}</p>` : ''}
</div>`;
    }

    private renderDefaultSlide(slide: Slide, theme: ThemeConfig): string {
        return `
<div style={{
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '${theme.gradient || theme.backgroundColor}',
    color: '${theme.textColor}',
    padding: '4rem'
}}>
    <h2 style={{
        fontSize: '2.5rem',
        fontFamily: ${JSON.stringify(theme.titleFont)},
        fontWeight: 'bold',
        marginBottom: '2rem',
        color: '${theme.primaryColor}'
    }}>${slide.title}</h2>
    <div style={{ fontSize: '${theme.bodySize}', fontFamily: ${JSON.stringify(theme.bodyFont)}, flex: 1 }}>
        ${slide.content.split('\n').map(line => `<p style={{ marginBottom: '1rem' }}>${line}</p>`).join('\n')}
    </div>
</div>`;
    }

    private renderTwoColumnSlide(slide: Slide, theme: ThemeConfig): string {
        const [left, right] = slide.content.split('---').map(s => s.trim());
        return `
<div style={{
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '${theme.gradient || theme.backgroundColor}',
    color: '${theme.textColor}',
    padding: '4rem'
}}>
    <h2 style={{ fontSize: '2.5rem', marginBottom: '2rem', color: '${theme.primaryColor}' }}>${slide.title}</h2>
    <div style={{ display: 'flex', gap: '4rem', flex: 1 }}>
        <div style={{ flex: 1 }}>${left || ''}</div>
        <div style={{ flex: 1 }}>${right || ''}</div>
    </div>
</div>`;
    }

    private renderFullImageSlide(slide: Slide, theme: ThemeConfig): string {
        const bgImage = slide.backgroundImage || slide.assets[0]?.src || '';
        return `
<div style={{
    height: '100vh',
    backgroundImage: 'url(${bgImage})',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    display: 'flex',
    alignItems: 'flex-end',
    padding: '4rem'
}}>
    <div style={{
        background: 'rgba(0,0,0,0.7)',
        padding: '2rem',
        borderRadius: '${theme.borderRadius}',
        color: 'white'
    }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>${slide.title}</h2>
        <p>${slide.content}</p>
    </div>
</div>`;
    }

    private renderListSlide(slide: Slide, theme: ThemeConfig): string {
        const items = slide.content.split('\n').filter(l => l.trim());
        return `
<div style={{
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '${theme.gradient || theme.backgroundColor}',
    color: '${theme.textColor}',
    padding: '4rem'
}}>
    <h2 style={{ fontSize: '2.5rem', marginBottom: '2rem', color: '${theme.primaryColor}' }}>${slide.title}</h2>
    <ul style={{ fontSize: '${theme.bodySize}', listStyle: 'none', padding: 0 }}>
        ${items.map(item => `
        <li style={{ 
            marginBottom: '1.5rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '1rem' 
        }}>
            <span style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                background: '${theme.primaryColor}' 
            }}></span>
            ${item.replace(/^[•\-*]\s*/, '')}
        </li>`).join('')}
    </ul>
</div>`;
    }

    private renderQuoteSlide(slide: Slide, theme: ThemeConfig): string {
        return `
<div style={{
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '${theme.gradient || theme.backgroundColor}',
    color: '${theme.textColor}',
    padding: '4rem',
    textAlign: 'center'
}}>
    <blockquote style={{
        fontSize: '2rem',
        fontStyle: 'italic',
        maxWidth: '800px',
        lineHeight: 1.6,
        position: 'relative'
    }}>
        <span style={{ fontSize: '4rem', color: '${theme.primaryColor}', position: 'absolute', left: '-2rem', top: '-1rem' }}>"</span>
        ${slide.content}
        <span style={{ fontSize: '4rem', color: '${theme.primaryColor}' }}>"</span>
    </blockquote>
    ${slide.title ? `<cite style={{ marginTop: '2rem', opacity: 0.7 }}>— ${slide.title}</cite>` : ''}
</div>`;
    }

    private renderChartSlide(slide: Slide, theme: ThemeConfig): string {
        if (!slide.chartData) {
            return this.renderDefaultSlide(slide, theme);
        }

        const { type, data, xKey, yKeys } = slide.chartData;
        const ChartComponent = type === 'bar' ? 'BarChart' :
            type === 'line' ? 'LineChart' :
                type === 'pie' ? 'PieChart' :
                    type === 'area' ? 'AreaChart' : 'BarChart';

        return `
<div style={{
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '${theme.gradient || theme.backgroundColor}',
    color: '${theme.textColor}',
    padding: '4rem'
}}>
    <h2 style={{ fontSize: '2.5rem', marginBottom: '2rem', color: '${theme.primaryColor}' }}>${slide.title}</h2>
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <${ChartComponent} width={700} height={400} data={${JSON.stringify(data)}}>
            <XAxis dataKey="${xKey}" stroke="${theme.textColor}" />
            <YAxis stroke="${theme.textColor}" />
            <Tooltip />
            ${yKeys.map((key, i) => `<Bar dataKey="${key}" fill="${theme.primaryColor}" />`).join('\n')}
        </${ChartComponent}>
    </div>
</div>`;
    }

    /** Render full presentation to standalone HTML */
    renderToHTML(presentation: Presentation): string {
        const theme = getThemeConfig(presentation.theme, presentation.customTheme);
        const slidesHtml = presentation.slides.map((slide, i) => `
            <section class="slide" id="slide-${i}">
                ${this.renderSlideToHTML(slide, theme)}
            </section>
        `).join('\n');

        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${presentation.title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Outfit:wght@700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { height: 100%; overflow: hidden; }
        .slide { 
            width: 100vw; 
            height: 100vh; 
            display: none; 
            font-family: ${theme.bodyFont};
        }
        .slide.active { display: block; }
        .nav { 
            position: fixed; 
            bottom: 2rem; 
            left: 50%; 
            transform: translateX(-50%);
            display: flex;
            gap: 1rem;
            z-index: 1000;
        }
        .nav button {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 0.5rem;
            background: rgba(0,0,0,0.5);
            color: white;
            cursor: pointer;
            font-size: 1rem;
        }
        .nav button:hover { background: rgba(0,0,0,0.7); }
        .progress {
            position: fixed;
            bottom: 0;
            left: 0;
            height: 4px;
            background: ${theme.primaryColor};
            transition: width 0.3s;
        }
    </style>
</head>
<body>
    ${slidesHtml}
    <div class="nav">
        <button onclick="prevSlide()">← Anterior</button>
        <span id="counter">1 / ${presentation.slides.length}</span>
        <button onclick="nextSlide()">Siguiente →</button>
    </div>
    <div class="progress" id="progress" style="width: ${100 / presentation.slides.length}%"></div>
    <script>
        let current = 0;
        const slides = document.querySelectorAll('.slide');
        const total = slides.length;
        
        function showSlide(n) {
            slides.forEach(s => s.classList.remove('active'));
            current = (n + total) % total;
            slides[current].classList.add('active');
            document.getElementById('counter').textContent = \`\${current + 1} / \${total}\`;
            document.getElementById('progress').style.width = \`\${((current + 1) / total) * 100}%\`;
        }
        
        function nextSlide() { showSlide(current + 1); }
        function prevSlide() { showSlide(current - 1); }
        
        document.addEventListener('keydown', e => {
            if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
            if (e.key === 'ArrowLeft') prevSlide();
        });
        
        showSlide(0);
    </script>
</body>
</html>`;
    }

    /** Render a slide to HTML (used in full HTML export) */
    private renderSlideToHTML(slide: Slide, theme: ThemeConfig): string {
        // Convert TSX-like output to plain HTML
        const bgStyle = slide.backgroundColor || theme.backgroundColor;
        const gradient = theme.gradient || bgStyle;

        return `
<div style="
    height: 100vh;
    display: flex;
    flex-direction: column;
    ${slide.layout === 'title' ? 'align-items: center; justify-content: center; text-align: center;' : ''}
    background: ${gradient};
    color: ${theme.textColor};
    padding: 4rem;
    font-family: ${theme.bodyFont};
">
    <h2 style="
        font-size: ${slide.layout === 'title' ? theme.titleSize : '2.5rem'};
        font-family: ${theme.titleFont};
        margin-bottom: 2rem;
        color: ${slide.layout === 'title' ? theme.textColor : theme.primaryColor};
    ">${slide.title}</h2>
    ${slide.subtitle ? `<p style="font-size: 1.5rem; opacity: 0.8; margin-bottom: 2rem;">${slide.subtitle}</p>` : ''}
    <div style="font-size: ${theme.bodySize}; flex: 1;">
        ${this.formatContent(slide.content, slide.layout, theme)}
    </div>
    ${slide.assets.length > 0 ? this.renderAssetsHTML(slide.assets) : ''}
</div>`;
    }

    private formatContent(content: string, layout: SlideLayout, theme: ThemeConfig): string {
        if (layout === 'list') {
            const items = content.split('\n').filter(l => l.trim());
            return `<ul style="list-style: none; padding: 0;">
                ${items.map(item => `
                    <li style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem;">
                        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${theme.primaryColor};"></span>
                        ${item.replace(/^[•\-*]\s*/, '')}
                    </li>
                `).join('')}
            </ul>`;
        }

        return content.split('\n').map(line =>
            `<p style="margin-bottom: 1rem;">${line}</p>`
        ).join('');
    }

    private renderAssetsHTML(assets: SlideAsset[]): string {
        return assets.map(asset => {
            if (asset.type === 'image') {
                return `<img src="${asset.src}" alt="${asset.alt || ''}" style="max-width: 100%; max-height: 40vh; object-fit: contain; margin-top: 2rem;" />`;
            }
            return '';
        }).join('');
    }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const presentationEngine = new PresentationEngine();
