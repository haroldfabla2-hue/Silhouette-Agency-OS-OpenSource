
import Replicate from "replicate";
import { costEstimator } from "../costEstimator";

/**
 * Comprehensive Image Style Types for NanoBanana Pro
 * ═══════════════════════════════════════════════════════════════
 * Organized into categories for easy selection
 */

// Technical & Professional
export type TechnicalStyle =
    | 'TECHNICAL'      // Technical diagrams with labels
    | 'BLUEPRINT'      // Architectural blueprints
    | 'SCHEMATIC'      // Circuit/system schematics
    | 'WIREFRAME'      // UI/UX wireframes
    | 'FLOWCHART'      // Process flowcharts
    | 'EXPLODED'       // Exploded view diagrams
    | 'CROSS_SECTION'; // Cross-section views

// 3D & Rendering
export type RenderStyle =
    | 'RENDER_3D'          // High-quality 3D render
    | 'ISOMETRIC'          // Isometric 3D view
    | 'PRODUCT_SHOT'       // Product photography render
    | 'ARCHITECTURAL'      // Architectural visualization
    | 'INTERIOR_DESIGN'    // Interior design render
    | 'CAD';               // CAD-like technical render

// Data & Business
export type DataStyle =
    | 'INFOGRAPHIC'    // Data infographics
    | 'CHART'          // Charts and graphs
    | 'DASHBOARD'      // Dashboard mockups
    | 'PRESENTATION'   // Presentation slides
    | 'REPORT'         // Report figures
    | 'DIAGRAM';       // General diagrams

// Creative & Artistic
export type ArtisticStyle =
    | 'ILLUSTRATION'       // Vector-style illustration
    | 'ANIME'              // Anime/manga style
    | 'COMIC'              // Comic book style
    | 'WATERCOLOR'         // Watercolor painting
    | 'OIL_PAINTING'       // Oil painting style
    | 'SKETCH'             // Pencil sketch
    | 'DIGITAL_ART'        // Digital art
    | 'CONCEPT_ART'        // Concept art
    | 'MINIMALIST'         // Minimalist design
    | 'RETRO'              // Retro/vintage style
    | 'CYBERPUNK'          // Cyberpunk aesthetic
    | 'FANTASY';           // Fantasy art

// Photography & Realistic
export type PhotoStyle =
    | 'PHOTOREALISTIC'     // Ultra-realistic photo
    | 'PORTRAIT'           // Portrait photography
    | 'LANDSCAPE'          // Landscape photography
    | 'MACRO'              // Macro photography
    | 'AERIAL'             // Aerial/drone view
    | 'FASHION'            // Fashion photography
    | 'FOOD'               // Food photography
    | 'PRODUCT';           // Product photography

// UI/UX & Design
export type UIStyle =
    | 'UI_MOCKUP'          // UI design mockup
    | 'APP_SCREEN'         // Mobile app screen
    | 'WEBSITE'            // Website design
    | 'ICON'               // Icon design
    | 'LOGO'               // Logo design
    | 'BANNER'             // Banner/hero image
    | 'SOCIAL_MEDIA';      // Social media post

// Marketing & Business
export type MarketingStyle =
    | 'ADVERTISEMENT'      // Ad creative
    | 'BROCHURE'           // Brochure design
    | 'POSTER'             // Poster design
    | 'BOOK_COVER'         // Book cover
    | 'MAGAZINE'           // Magazine layout
    | 'PACKAGING';         // Product packaging

// Combined type for all styles
export type ImageStyle =
    | TechnicalStyle
    | RenderStyle
    | DataStyle
    | ArtisticStyle
    | PhotoStyle
    | UIStyle
    | MarketingStyle
    | 'CUSTOM';  // For custom/unspecified styles

export class NanoBananaService {
    private replicate: Replicate | null = null;
    private modelId: string = 'google/nano-banana-pro';
    private initialized: boolean = false;

    constructor() {
        // [ROBUST] Don't read env in constructor - dotenv might not be loaded yet
        // Initialization happens lazily on first use
    }

    /**
     * Ensure service is initialized (lazy load)
     * Called before any API operation
     */
    private ensureInitialized(): void {
        if (this.initialized) return;
        this.initialized = true;

        const token = process.env.REPLICATE_API_TOKEN;
        this.modelId = process.env.NANOBANANA_MODEL_ID || 'google/nano-banana-pro';

        if (token) {
            this.replicate = new Replicate({ auth: token });
            console.log("[NanoBanana] ✅ Pro Service Initialized (lazy load)");
        } else {
            console.warn("[NanoBanana] ⚠️ REPLICATE_API_TOKEN missing. Service disabled.");
        }
    }

    /**
     * Generate image with optional style enhancement
     */
    public async generateImage(
        prompt: string,
        aspectRatio: string = "16:9",
        style?: ImageStyle
    ): Promise<string | null> {
        this.ensureInitialized();
        if (!this.replicate) return null;

        // Enhance prompt based on style
        const enhancedPrompt = this.enhancePrompt(prompt, style);

        console.log(`[NanoBanana] 🎨 Generating (${style || 'custom'}): "${prompt.slice(0, 50)}..." (${aspectRatio})`);

        try {
            // Build input compatible with flux-schnell / flux-dev
            const input: Record<string, any> = {
                prompt: enhancedPrompt,
            };

            // Add aspect ratio if provided (flux models support this)
            if (aspectRatio) {
                input.aspect_ratio = aspectRatio;
            }

            console.log(`[NanoBanana] 📦 Using model: ${this.modelId}`);
            const output = await this.replicate.run(this.modelId as `${string}/${string}`, { input });

            // Handle various output formats from different models
            let imageUrl: string | null = null;
            if (typeof output === 'string') {
                imageUrl = output;
            } else if (Array.isArray(output) && output.length > 0) {
                imageUrl = String(output[0]);
            } else if (output && typeof output === 'object' && 'url' in output) {
                imageUrl = (output as any).url;
            }

            if (!imageUrl) {
                console.error("[NanoBanana] ❌ No image URL in response:", output);
                return null;
            }

            costEstimator.trackTransaction(100, 1000, "flux-schnell");

            console.log(`[NanoBanana] ✅ Generated: ${imageUrl.substring(0, 80)}...`);
            return imageUrl;

        } catch (error: any) {
            console.error("[NanoBanana] ❌ Generation Failed:", error.message);
            return null;
        }
    }

    /**
     * Get list of available styles by category
     */
    public getAvailableStyles(): Record<string, string[]> {
        return {
            technical: ['TECHNICAL', 'BLUEPRINT', 'SCHEMATIC', 'WIREFRAME', 'FLOWCHART', 'EXPLODED', 'CROSS_SECTION'],
            render3d: ['RENDER_3D', 'ISOMETRIC', 'PRODUCT_SHOT', 'ARCHITECTURAL', 'INTERIOR_DESIGN', 'CAD'],
            data: ['INFOGRAPHIC', 'CHART', 'DASHBOARD', 'PRESENTATION', 'REPORT', 'DIAGRAM'],
            artistic: ['ILLUSTRATION', 'ANIME', 'COMIC', 'WATERCOLOR', 'OIL_PAINTING', 'SKETCH', 'DIGITAL_ART', 'CONCEPT_ART', 'MINIMALIST', 'RETRO', 'CYBERPUNK', 'FANTASY'],
            photography: ['PHOTOREALISTIC', 'PORTRAIT', 'LANDSCAPE', 'MACRO', 'AERIAL', 'FASHION', 'FOOD', 'PRODUCT'],
            uiux: ['UI_MOCKUP', 'APP_SCREEN', 'WEBSITE', 'ICON', 'LOGO', 'BANNER', 'SOCIAL_MEDIA'],
            marketing: ['ADVERTISEMENT', 'BROCHURE', 'POSTER', 'BOOK_COVER', 'MAGAZINE', 'PACKAGING']
        };
    }

    /**
     * Enhanced prompt generation with professional presets
     */
    private enhancePrompt(prompt: string, style?: ImageStyle): string {
        if (!style || style === 'CUSTOM') return prompt;

        const styleEnhancements: Record<ImageStyle, string> = {
            // ═══════════════════════════════════════════════════════════
            // TECHNICAL & PROFESSIONAL
            // ═══════════════════════════════════════════════════════════
            'TECHNICAL':
                'precise technical diagram, engineering illustration, clean vector lines, professional schematic, ' +
                'labeled components, white background, high contrast, precise measurements, technical drawing style,',

            'BLUEPRINT':
                'detailed architectural blueprint, technical drawing on blue grid paper, white lines, ' +
                'precise measurements, construction plans, engineering document, CAD style,',

            'SCHEMATIC':
                'electronic schematic diagram, circuit board layout, electrical engineering diagram, ' +
                'components clearly labeled, clean technical illustration, professional engineering style,',

            'WIREFRAME':
                'UI/UX wireframe design, clean layout structure, grayscale mockup, user interface skeleton, ' +
                'placeholder elements, grid-based design, professional wireframe style,',

            'FLOWCHART':
                'professional flowchart diagram, process flow visualization, connected nodes, ' +
                'clear decision points, business process diagram, clean vector graphics,',

            'EXPLODED':
                'exploded view diagram, all components separated and floating, assembly visualization, ' +
                'parts breakdown, technical illustration, product disassembly view, clear labeling,',

            'CROSS_SECTION':
                'cross-section view, cutaway diagram, internal structure visible, technical illustration, ' +
                'layers and components exposed, precise engineering visualization,',

            // ═══════════════════════════════════════════════════════════
            // 3D & RENDERING
            // ═══════════════════════════════════════════════════════════
            'RENDER_3D':
                'professional 3D render, high quality CGI, photorealistic lighting, studio environment, ' +
                'ray tracing, global illumination, 8K quality, octane render style,',

            'ISOMETRIC':
                'isometric 3D illustration, clean geometric shapes, 30-degree angle view, ' +
                'colorful flat design, vector-like 3D, modern isometric style,',

            'PRODUCT_SHOT':
                'professional product photography, studio lighting, clean background, ' +
                'commercial quality, hero shot, promotional image, high-end product visualization,',

            'ARCHITECTURAL':
                'architectural visualization, exterior render, building design, professional arch-viz, ' +
                'natural lighting, urban context, photorealistic architecture,',

            'INTERIOR_DESIGN':
                'interior design visualization, room render, modern furniture, natural lighting, ' +
                'cozy atmosphere, architectural interior, home decoration style,',

            'CAD':
                'CAD technical render, 3D model visualization, engineering design, precise geometry, ' +
                'mechanical parts, technical 3D view, industrial design,',

            // ═══════════════════════════════════════════════════════════
            // DATA & BUSINESS
            // ═══════════════════════════════════════════════════════════
            'INFOGRAPHIC':
                'professional infographic design, data visualization, clean typography, modern icons, ' +
                'color-coded sections, readable text, statistical graphics, business presentation style,',

            'CHART':
                'professional chart visualization, clean data graphics, modern design, ' +
                'clear labels, business analytics style, presentation quality,',

            'DASHBOARD':
                'business dashboard mockup, data analytics interface, KPI visualization, ' +
                'modern UI design, dark mode compatible, professional metrics display,',

            'PRESENTATION':
                'presentation slide design, professional layout, corporate style, ' +
                'clean typography, modern business aesthetic, PowerPoint quality,',

            'REPORT':
                'report figure, academic paper illustration, professional documentation, ' +
                'scientific visualization, clear and precise, publication quality,',

            'DIAGRAM':
                'professional diagram, conceptual visualization, clear relationships, ' +
                'modern design, business diagram style, organized layout,',

            // ═══════════════════════════════════════════════════════════
            // CREATIVE & ARTISTIC
            // ═══════════════════════════════════════════════════════════
            'ILLUSTRATION':
                'professional vector illustration, clean design, modern flat style, ' +
                'colorful graphics, digital illustration, commercial artwork,',

            'ANIME':
                'anime style illustration, Japanese animation aesthetic, vibrant colors, ' +
                'detailed character art, manga-inspired, dynamic poses, clean linework,',

            'COMIC':
                'comic book art style, bold outlines, dynamic composition, ' +
                'halftone effects, superhero aesthetic, graphic novel illustration, pop art influence,',

            'WATERCOLOR':
                'watercolor painting, soft color washes, organic textures, ' +
                'artistic brush strokes, traditional media aesthetic, delicate blending,',

            'OIL_PAINTING':
                'oil painting style, rich textures, classical art technique, ' +
                'museum quality, masterpiece aesthetic, visible brush strokes, renaissance style,',

            'SKETCH':
                'pencil sketch, detailed line drawing, artistic sketch style, ' +
                'hand-drawn aesthetic, graphite texture, illustration sketch,',

            'DIGITAL_ART':
                'digital art, trending on artstation, highly detailed, ' +
                'dramatic lighting, professional digital painting, 4K resolution,',

            'CONCEPT_ART':
                'concept art, entertainment industry quality, cinematic composition, ' +
                'detailed environment design, professional game/film art,',

            'MINIMALIST':
                'minimalist design, clean aesthetic, simple shapes, negative space, ' +
                'modern art style, elegant simplicity, refined composition,',

            'RETRO':
                'retro vintage style, nostalgic aesthetic, 80s/90s design, ' +
                'retro color palette, vintage texture, throwback vibes,',

            'CYBERPUNK':
                'cyberpunk aesthetic, neon lights, futuristic dystopia, ' +
                'high tech low life, blade runner inspired, dark sci-fi,',

            'FANTASY':
                'fantasy art, magical atmosphere, epic composition, ' +
                'mythical creatures, enchanted world, high fantasy aesthetic,',

            // ═══════════════════════════════════════════════════════════
            // PHOTOGRAPHY & REALISTIC
            // ═══════════════════════════════════════════════════════════
            'PHOTOREALISTIC':
                'photorealistic, ultra detailed, professional photography, ' +
                'perfect lighting, 8K resolution, hyperrealistic, DSLR quality,',

            'PORTRAIT':
                'professional portrait photography, studio lighting, sharp focus, ' +
                'beautiful bokeh, high-end fashion photography, magazine quality,',

            'LANDSCAPE':
                'landscape photography, golden hour lighting, epic vista, ' +
                'national geographic quality, dramatic sky, pristine nature,',

            'MACRO':
                'macro photography, extreme close-up, intricate details, ' +
                'shallow depth of field, professional focus stacking,',

            'AERIAL':
                'aerial photography, drone view, bird\'s eye perspective, ' +
                'sweeping landscape, cinematic drone shot, high altitude view,',

            'FASHION':
                'fashion photography, high-end editorial, runway style, ' +
                'professional model shot, luxury fashion aesthetic, vogue magazine style,',

            'FOOD':
                'food photography, appetizing presentation, professional food styling, ' +
                'natural lighting, gourmet aesthetic, restaurant menu quality,',

            'PRODUCT':
                'product photography, e-commerce quality, clean white background, ' +
                'professional studio shot, commercial photography,',

            // ═══════════════════════════════════════════════════════════
            // UI/UX & DESIGN
            // ═══════════════════════════════════════════════════════════
            'UI_MOCKUP':
                'UI design mockup, modern interface, clean layout, ' +
                'professional app design, figma-style presentation, design system,',

            'APP_SCREEN':
                'mobile app screen design, iOS/Android interface, modern UI, ' +
                'clean user experience, professional app design, smartphone mockup,',

            'WEBSITE':
                'website design, modern landing page, responsive layout, ' +
                'professional web design, hero section, SaaS aesthetic,',

            'ICON':
                'professional icon design, clean vector icon, modern app icon, ' +
                'consistent style, scalable design, iconography,',

            'LOGO':
                'professional logo design, brand identity, clean typography, ' +
                'memorable mark, corporate branding, versatile logo,',

            'BANNER':
                'banner design, hero image, web header, promotional banner, ' +
                'eye-catching design, call to action, marketing visual,',

            'SOCIAL_MEDIA':
                'social media post design, instagram/twitter aesthetic, ' +
                'engaging visual, modern graphics, shareable content,',

            // ═══════════════════════════════════════════════════════════
            // MARKETING & BUSINESS
            // ═══════════════════════════════════════════════════════════
            'ADVERTISEMENT':
                'advertising creative, professional ad design, marketing visual, ' +
                'compelling composition, eye-catching design, promotional material,',

            'BROCHURE':
                'brochure design, professional print layout, corporate style, ' +
                'informative design, marketing collateral, fold design,',

            'POSTER':
                'poster design, eye-catching visual, bold typography, ' +
                'promotional artwork, event poster, professional print design,',

            'BOOK_COVER':
                'book cover design, bestseller aesthetic, compelling cover art, ' +
                'professional publishing quality, genre-appropriate design,',

            'MAGAZINE':
                'magazine layout, editorial design, professional publication, ' +
                'glossy aesthetic, feature article style, print quality,',

            'PACKAGING':
                'product packaging design, retail ready, shelf appeal, ' +
                'professional package mockup, consumer goods design, branding,',

            // Fallback for CUSTOM
            'CUSTOM': ''
        };

        const enhancement = styleEnhancements[style] || '';
        return enhancement ? `${enhancement} ${prompt}` : prompt;
    }

    public async editImage(imageUrl: string, prompt: string): Promise<string | null> {
        this.ensureInitialized();
        if (!this.replicate) return null;
        console.warn("[NanoBanana] Edit not fully supported in this version.");
        return null;
    }
}

export const nanoBanana = new NanoBananaService();
