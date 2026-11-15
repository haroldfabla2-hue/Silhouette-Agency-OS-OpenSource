// =============================================================================
// Nexus Canvas - Text Tool
// Creates and manages text layers
// =============================================================================

import type { TextLayerData, CanvasColor } from '../../../types/canvas';

// Default text settings
const DEFAULT_TEXT_DATA: TextLayerData = {
    content: 'Double-click to edit',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 400,
    color: { r: 255, g: 255, b: 255, a: 1 },
    alignment: 'center'
};

// Popular Google Fonts for selection
export const AVAILABLE_FONTS = [
    'Inter',
    'Roboto',
    'Poppins',
    'Open Sans',
    'Lato',
    'Montserrat',
    'Oswald',
    'Playfair Display',
    'Merriweather',
    'Source Sans Pro',
    'Nunito',
    'Raleway',
    'Ubuntu',
    'PT Sans',
    'Rubik'
];

class TextTool {
    private isEditing: boolean = false;
    private editingLayerId: string | null = null;

    /**
     * Create default text data for a new text layer
     */
    createDefaultTextData(): TextLayerData {
        return { ...DEFAULT_TEXT_DATA };
    }

    /**
     * Start editing a text layer
     */
    startEditing(layerId: string): void {
        this.isEditing = true;
        this.editingLayerId = layerId;
        console.log('[TextTool] Started editing layer:', layerId);
    }

    /**
     * Stop editing
     */
    stopEditing(): void {
        this.isEditing = false;
        this.editingLayerId = null;
        console.log('[TextTool] Stopped editing');
    }

    /**
     * Check if currently editing a specific layer
     */
    isEditingLayer(layerId: string): boolean {
        return this.isEditing && this.editingLayerId === layerId;
    }

    /**
     * Get current editing state
     */
    getEditingState(): { isEditing: boolean; layerId: string | null } {
        return {
            isEditing: this.isEditing,
            layerId: this.editingLayerId
        };
    }

    /**
     * Update text content
     */
    updateContent(textData: TextLayerData, newContent: string): TextLayerData {
        return { ...textData, content: newContent };
    }

    /**
     * Update font family
     */
    updateFontFamily(textData: TextLayerData, fontFamily: string): TextLayerData {
        return { ...textData, fontFamily };
    }

    /**
     * Update font size
     */
    updateFontSize(textData: TextLayerData, fontSize: number): TextLayerData {
        return { ...textData, fontSize: Math.max(8, Math.min(500, fontSize)) };
    }

    /**
     * Update font weight
     */
    updateFontWeight(textData: TextLayerData, fontWeight: 400 | 700): TextLayerData {
        return { ...textData, fontWeight };
    }

    /**
     * Update text color
     */
    updateColor(textData: TextLayerData, color: CanvasColor): TextLayerData {
        return { ...textData, color };
    }

    /**
     * Update text alignment
     */
    updateAlignment(textData: TextLayerData, alignment: 'left' | 'center' | 'right'): TextLayerData {
        return { ...textData, alignment };
    }

    /**
     * Convert TextLayerData to PixiJS TextStyle options
     */
    toPixiStyle(textData: TextLayerData): Record<string, any> {
        return {
            fontFamily: textData.fontFamily,
            fontSize: textData.fontSize,
            fontWeight: textData.fontWeight === 700 ? 'bold' : 'normal',
            fill: `rgba(${textData.color.r}, ${textData.color.g}, ${textData.color.b}, ${textData.color.a})`,
            align: textData.alignment,
            wordWrap: true,
            wordWrapWidth: 800, // Default wrap width
            lineHeight: textData.fontSize * 1.2
        };
    }
}

export const textTool = new TextTool();
