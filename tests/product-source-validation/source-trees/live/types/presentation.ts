/**
 * PRESENTATION TYPES
 * ═══════════════════════════════════════════════════════════════
 * Core data model for Silhouette's native presentation system.
 * Enables AI-generated slides comparable to Gamma.app.
 */

// ═══════════════════════════════════════════════════════════════
// SLIDE TYPES
// ═══════════════════════════════════════════════════════════════

/** Available slide layouts */
export type SlideLayout =
    | 'title'           // Hero slide with title + subtitle
    | 'title-content'   // Title + main content area
    | 'two-column'      // Side by side content
    | 'full-image'      // Background image with text overlay
    | 'comparison'      // Two items compared side by side
    | 'list'            // Bullet points or numbered list
    | 'quote'           // Large quote with attribution
    | 'chart'           // Data visualization focus
    | 'blank';          // Custom layout

/** Asset embedded in a slide */
export interface SlideAsset {
    id: string;
    type: 'image' | 'chart' | 'icon' | 'video';
    src: string;            // Base64 data URI or URL
    alt?: string;           // Accessibility text
    position?: {
        x: number;          // Percentage (0-100)
        y: number;
        width: number;
        height: number;
    };
    aiGenerated?: boolean;  // Whether asset was AI-generated
    generationPrompt?: string;
}

/** Chart data for data visualization slides */
export interface ChartData {
    type: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
    title?: string;
    data: Array<Record<string, string | number>>;
    xKey: string;
    yKeys: string[];
    colors?: string[];
}

/** A single slide in a presentation */
export interface Slide {
    id: string;
    order: number;

    // Content
    title: string;
    subtitle?: string;
    content: string;            // Markdown or plain text
    notes?: string;             // Speaker notes

    // Layout & Style
    layout: SlideLayout;
    backgroundColor?: string;   // CSS color or gradient
    backgroundImage?: string;   // Base64 or URL
    textColor?: string;

    // Media
    assets: SlideAsset[];
    chartData?: ChartData;

    // Metadata
    aiGenerated?: boolean;
    createdAt: number;
    updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// PRESENTATION TYPES
// ═══════════════════════════════════════════════════════════════

/** Available presentation themes */
export type PresentationTheme =
    | 'modern-dark'     // Dark with gradients, tech feel
    | 'corporate'       // Clean professional blues
    | 'pitch-deck'      // Startup style, bold colors
    | 'academic'        // Formal, serif fonts
    | 'minimal'         // White, clean, lots of whitespace
    | 'creative';       // Playful, colorful

/** Theme configuration */
export interface ThemeConfig {
    name: PresentationTheme;
    displayName: string;

    // Colors
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
    accentColor: string;

    // Typography
    titleFont: string;
    bodyFont: string;
    titleSize: string;
    bodySize: string;

    // Styling
    borderRadius: string;
    boxShadow: string;
    gradient?: string;
}

/** Complete presentation document */
export interface Presentation {
    id: string;
    title: string;
    description?: string;
    author?: string;

    // Theme
    theme: PresentationTheme;
    customTheme?: Partial<ThemeConfig>;

    // Content
    slides: Slide[];

    // Metadata
    tags?: string[];
    createdAt: number;
    updatedAt: number;

    // Export tracking
    lastExportedAt?: number;
    exportFormat?: 'pdf' | 'html';
}

// ═══════════════════════════════════════════════════════════════
// GENERATION TYPES
// ═══════════════════════════════════════════════════════════════

/** Request to generate a presentation */
export interface PresentationGenerationRequest {
    topic: string;
    numSlides: number;
    theme: PresentationTheme;
    includeResearch: boolean;
    generateImages: boolean;
    targetAudience?: string;
    style?: 'formal' | 'casual' | 'technical';
    language?: string;
}

/** Outline generated before full slide creation */
export interface PresentationOutline {
    title: string;
    slideOutlines: Array<{
        title: string;
        keyPoints: string[];
        suggestedLayout: SlideLayout;
        needsImage: boolean;
    }>;
}

// ═══════════════════════════════════════════════════════════════
// PREDEFINED THEMES
// ═══════════════════════════════════════════════════════════════

export const THEME_CONFIGS: Record<PresentationTheme, ThemeConfig> = {
    'modern-dark': {
        name: 'modern-dark',
        displayName: 'Modern Dark',
        primaryColor: '#06b6d4',     // Cyan
        secondaryColor: '#8b5cf6',   // Purple
        backgroundColor: '#0f172a',  // Slate-900
        textColor: '#f1f5f9',        // Slate-100
        accentColor: '#22d3ee',      // Cyan-400
        titleFont: "'Inter', sans-serif",
        bodyFont: "'Inter', sans-serif",
        titleSize: '3rem',
        bodySize: '1.25rem',
        borderRadius: '0.75rem',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        gradient: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
    },
    'corporate': {
        name: 'corporate',
        displayName: 'Corporate',
        primaryColor: '#2563eb',     // Blue-600
        secondaryColor: '#1e40af',   // Blue-800
        backgroundColor: '#ffffff',
        textColor: '#1e293b',        // Slate-800
        accentColor: '#3b82f6',      // Blue-500
        titleFont: "'Roboto', sans-serif",
        bodyFont: "'Roboto', sans-serif",
        titleSize: '2.5rem',
        bodySize: '1.125rem',
        borderRadius: '0.5rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    },
    'pitch-deck': {
        name: 'pitch-deck',
        displayName: 'Pitch Deck',
        primaryColor: '#f97316',     // Orange-500
        secondaryColor: '#ea580c',   // Orange-600
        backgroundColor: '#18181b',  // Zinc-900
        textColor: '#fafafa',        // Zinc-50
        accentColor: '#fb923c',      // Orange-400
        titleFont: "'Outfit', sans-serif",
        bodyFont: "'Inter', sans-serif",
        titleSize: '3.5rem',
        bodySize: '1.25rem',
        borderRadius: '1rem',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
        gradient: 'linear-gradient(180deg, #18181b 0%, #27272a 100%)'
    },
    'academic': {
        name: 'academic',
        displayName: 'Academic',
        primaryColor: '#1e3a5f',     // Navy
        secondaryColor: '#2d4a6f',
        backgroundColor: '#fefefe',
        textColor: '#1a1a1a',
        accentColor: '#c41e3a',      // Cardinal
        titleFont: "'Georgia', serif",
        bodyFont: "'Times New Roman', serif",
        titleSize: '2.25rem',
        bodySize: '1.125rem',
        borderRadius: '0.25rem',
        boxShadow: 'none'
    },
    'minimal': {
        name: 'minimal',
        displayName: 'Minimal',
        primaryColor: '#000000',
        secondaryColor: '#525252',   // Neutral-600
        backgroundColor: '#ffffff',
        textColor: '#171717',        // Neutral-900
        accentColor: '#a3a3a3',      // Neutral-400
        titleFont: "'Helvetica Neue', sans-serif",
        bodyFont: "'Helvetica Neue', sans-serif",
        titleSize: '2.75rem',
        bodySize: '1.125rem',
        borderRadius: '0',
        boxShadow: 'none'
    },
    'creative': {
        name: 'creative',
        displayName: 'Creative',
        primaryColor: '#ec4899',     // Pink-500
        secondaryColor: '#8b5cf6',   // Violet-500
        backgroundColor: '#fdf4ff',  // Fuchsia-50
        textColor: '#4a044e',        // Fuchsia-950
        accentColor: '#d946ef',      // Fuchsia-500
        titleFont: "'Poppins', sans-serif",
        bodyFont: "'Nunito', sans-serif",
        titleSize: '3rem',
        bodySize: '1.25rem',
        borderRadius: '1.5rem',
        boxShadow: '0 10px 40px -10px rgba(236, 72, 153, 0.3)',
        gradient: 'linear-gradient(135deg, #fdf4ff 0%, #fae8ff 50%, #f5d0fe 100%)'
    }
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/** Create a new empty slide */
export function createSlide(order: number, layout: SlideLayout = 'title-content'): Slide {
    return {
        id: `slide_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        order,
        title: '',
        content: '',
        layout,
        assets: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/** Create a new presentation */
export function createPresentation(
    title: string,
    theme: PresentationTheme = 'modern-dark'
): Presentation {
    const now = Date.now();
    return {
        id: `pres_${now}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        theme,
        slides: [createSlide(0, 'title')],  // Start with title slide
        createdAt: now,
        updatedAt: now
    };
}

/** Get theme config with optional customizations */
export function getThemeConfig(
    theme: PresentationTheme,
    custom?: Partial<ThemeConfig>
): ThemeConfig {
    return { ...THEME_CONFIGS[theme], ...custom };
}
