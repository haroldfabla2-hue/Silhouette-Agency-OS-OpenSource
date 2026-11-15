/**
 * Shared Image Style Types for NanoBanana Pro
 * ═══════════════════════════════════════════════════════════════
 * Used by both frontend (MediaControlPanel) and backend (imageFactory)
 */

// Style categories with metadata for UI display
export const IMAGE_STYLE_CATEGORIES = {
    technical: {
        label: 'Technical',
        icon: '📐',
        color: 'from-slate-500 to-slate-600',
        styles: [
            { id: 'TECHNICAL', label: 'Technical', desc: 'Diagrams with labels' },
            { id: 'BLUEPRINT', label: 'Blueprint', desc: 'Architectural plans' },
            { id: 'SCHEMATIC', label: 'Schematic', desc: 'Circuit diagrams' },
            { id: 'WIREFRAME', label: 'Wireframe', desc: 'UI skeletons' },
            { id: 'FLOWCHART', label: 'Flowchart', desc: 'Process flows' },
            { id: 'EXPLODED', label: 'Exploded', desc: 'Parts breakdown' },
            { id: 'CROSS_SECTION', label: 'Cross Section', desc: 'Internal view' },
        ]
    },
    render3d: {
        label: '3D Render',
        icon: '🎮',
        color: 'from-purple-500 to-indigo-600',
        styles: [
            { id: 'RENDER_3D', label: '3D Render', desc: 'High-quality CGI' },
            { id: 'ISOMETRIC', label: 'Isometric', desc: 'Isometric 3D' },
            { id: 'PRODUCT_SHOT', label: 'Product Shot', desc: 'Studio product' },
            { id: 'ARCHITECTURAL', label: 'Architectural', desc: 'Building viz' },
            { id: 'INTERIOR_DESIGN', label: 'Interior', desc: 'Room render' },
            { id: 'CAD', label: 'CAD', desc: 'Technical 3D' },
        ]
    },
    data: {
        label: 'Data & Business',
        icon: '📊',
        color: 'from-blue-500 to-cyan-600',
        styles: [
            { id: 'INFOGRAPHIC', label: 'Infographic', desc: 'Data visual' },
            { id: 'CHART', label: 'Chart', desc: 'Graphs' },
            { id: 'DASHBOARD', label: 'Dashboard', desc: 'Analytics UI' },
            { id: 'PRESENTATION', label: 'Presentation', desc: 'Slide design' },
            { id: 'REPORT', label: 'Report', desc: 'Academic figure' },
            { id: 'DIAGRAM', label: 'Diagram', desc: 'Conceptual' },
        ]
    },
    artistic: {
        label: 'Artistic',
        icon: '🎨',
        color: 'from-pink-500 to-rose-600',
        styles: [
            { id: 'ILLUSTRATION', label: 'Illustration', desc: 'Vector style' },
            { id: 'ANIME', label: 'Anime', desc: 'Japanese style' },
            { id: 'COMIC', label: 'Comic', desc: 'Comic book' },
            { id: 'WATERCOLOR', label: 'Watercolor', desc: 'Soft washes' },
            { id: 'OIL_PAINTING', label: 'Oil Painting', desc: 'Classical' },
            { id: 'SKETCH', label: 'Sketch', desc: 'Pencil drawing' },
            { id: 'DIGITAL_ART', label: 'Digital Art', desc: 'Modern digital' },
            { id: 'CONCEPT_ART', label: 'Concept Art', desc: 'Game/film art' },
            { id: 'MINIMALIST', label: 'Minimalist', desc: 'Clean simple' },
            { id: 'RETRO', label: 'Retro', desc: '80s/90s style' },
            { id: 'CYBERPUNK', label: 'Cyberpunk', desc: 'Neon dystopia' },
            { id: 'FANTASY', label: 'Fantasy', desc: 'Magical worlds' },
        ]
    },
    photography: {
        label: 'Photography',
        icon: '📷',
        color: 'from-amber-500 to-orange-600',
        styles: [
            { id: 'PHOTOREALISTIC', label: 'Photorealistic', desc: 'Ultra real' },
            { id: 'PORTRAIT', label: 'Portrait', desc: 'Person photo' },
            { id: 'LANDSCAPE', label: 'Landscape', desc: 'Nature shots' },
            { id: 'MACRO', label: 'Macro', desc: 'Close-up' },
            { id: 'AERIAL', label: 'Aerial', desc: 'Drone view' },
            { id: 'FASHION', label: 'Fashion', desc: 'Editorial' },
            { id: 'FOOD', label: 'Food', desc: 'Food styling' },
            { id: 'PRODUCT', label: 'Product', desc: 'E-commerce' },
        ]
    },
    uiux: {
        label: 'UI/UX',
        icon: '💻',
        color: 'from-green-500 to-teal-600',
        styles: [
            { id: 'UI_MOCKUP', label: 'UI Mockup', desc: 'Interface design' },
            { id: 'APP_SCREEN', label: 'App Screen', desc: 'Mobile app' },
            { id: 'WEBSITE', label: 'Website', desc: 'Web design' },
            { id: 'ICON', label: 'Icon', desc: 'App icons' },
            { id: 'LOGO', label: 'Logo', desc: 'Brand mark' },
            { id: 'BANNER', label: 'Banner', desc: 'Hero image' },
            { id: 'SOCIAL_MEDIA', label: 'Social', desc: 'Post design' },
        ]
    },
    marketing: {
        label: 'Marketing',
        icon: '📣',
        color: 'from-red-500 to-pink-600',
        styles: [
            { id: 'ADVERTISEMENT', label: 'Advertisement', desc: 'Ad creative' },
            { id: 'BROCHURE', label: 'Brochure', desc: 'Print layout' },
            { id: 'POSTER', label: 'Poster', desc: 'Event poster' },
            { id: 'BOOK_COVER', label: 'Book Cover', desc: 'Cover art' },
            { id: 'MAGAZINE', label: 'Magazine', desc: 'Editorial' },
            { id: 'PACKAGING', label: 'Packaging', desc: 'Product box' },
        ]
    }
} as const;

// Extract all style IDs as a type
export type ImageStyleCategory = keyof typeof IMAGE_STYLE_CATEGORIES;
export type ImageStyle = typeof IMAGE_STYLE_CATEGORIES[ImageStyleCategory]['styles'][number]['id'];

// Helper to get all styles flat
export function getAllStyles(): { id: string; label: string; desc: string; category: string }[] {
    const result: { id: string; label: string; desc: string; category: string }[] = [];
    for (const [category, data] of Object.entries(IMAGE_STYLE_CATEGORIES)) {
        for (const style of data.styles) {
            result.push({ ...style, category });
        }
    }
    return result;
}

// Helper to get style by ID
export function getStyleById(id: string): { id: string; label: string; desc: string; category: string } | undefined {
    return getAllStyles().find(s => s.id === id);
}
