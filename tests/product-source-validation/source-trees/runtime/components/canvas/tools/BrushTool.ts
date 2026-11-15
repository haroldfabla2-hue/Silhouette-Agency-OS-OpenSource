// =============================================================================
// Nexus Canvas - Brush Tool
// Handles freehand drawing on the canvas
// =============================================================================

import * as PIXI from 'pixi.js';
import type { BrushSettings, CanvasColor } from '../../../types/canvas';

export class BrushTool {
    private graphics: PIXI.Graphics | null = null;
    private isDrawing: boolean = false;
    private lastPoint: { x: number; y: number } | null = null;
    private strokePath: { x: number; y: number }[] = [];

    private settings: BrushSettings = {
        size: 20,
        hardness: 75,
        opacity: 100,
        flow: 100,
        color: { r: 0, g: 0, b: 0, a: 1 }
    };

    /**
     * Initialize the brush tool with a container
     */
    init(container: PIXI.Container): void {
        this.graphics = new PIXI.Graphics();
        container.addChild(this.graphics);
    }

    /**
     * Update brush settings
     */
    setSettings(settings: Partial<BrushSettings>): void {
        Object.assign(this.settings, settings);
    }

    /**
     * Convert color to hex
     */
    private colorToHex(c: CanvasColor): number {
        return (c.r << 16) | (c.g << 8) | c.b;
    }

    /**
     * Start a new stroke
     */
    startStroke(x: number, y: number): void {
        if (!this.graphics) return;

        this.isDrawing = true;
        this.lastPoint = { x, y };
        this.strokePath = [{ x, y }];

        // Draw initial dot
        const color = this.colorToHex(this.settings.color);
        const alpha = (this.settings.opacity / 100) * (this.settings.flow / 100);

        this.graphics.circle(x, y, this.settings.size / 2);
        this.graphics.fill({ color, alpha });
    }

    /**
     * Continue stroke
     */
    continueStroke(x: number, y: number): void {
        if (!this.isDrawing || !this.graphics || !this.lastPoint) return;

        const color = this.colorToHex(this.settings.color);
        const alpha = (this.settings.opacity / 100) * (this.settings.flow / 100);

        // Draw line from last point to current
        this.graphics.setStrokeStyle({
            width: this.settings.size,
            color,
            alpha,
            cap: 'round',
            join: 'round'
        });

        this.graphics.moveTo(this.lastPoint.x, this.lastPoint.y);
        this.graphics.lineTo(x, y);
        this.graphics.stroke();

        // Draw circle at current point for smoothness
        this.graphics.circle(x, y, this.settings.size / 2);
        this.graphics.fill({ color, alpha });

        this.lastPoint = { x, y };
        this.strokePath.push({ x, y });
    }

    /**
     * End stroke
     */
    endStroke(): { x: number; y: number }[] {
        this.isDrawing = false;
        this.lastPoint = null;

        const path = [...this.strokePath];
        this.strokePath = [];

        return path;
    }

    /**
     * Clear the current drawing layer
     */
    clear(): void {
        this.graphics?.clear();
    }

    /**
     * Get the graphics object for rendering to texture
     */
    getGraphics(): PIXI.Graphics | null {
        return this.graphics;
    }

    /**
     * Render current brush strokes to a texture (for saving to layer)
     */
    renderToTexture(renderer: PIXI.Renderer, width: number, height: number): PIXI.RenderTexture | null {
        if (!this.graphics) return null;

        const texture = PIXI.RenderTexture.create({ width, height });
        renderer.render({ container: this.graphics, target: texture });

        return texture;
    }

    /**
     * Cleanup
     */
    destroy(): void {
        this.graphics?.destroy();
        this.graphics = null;
    }
}

// Export singleton
export const brushTool = new BrushTool();
