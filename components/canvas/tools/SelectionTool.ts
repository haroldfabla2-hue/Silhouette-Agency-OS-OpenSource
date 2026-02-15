// =============================================================================
// Nexus Canvas - Selection Tool
// Handles rectangular and freeform selections
// =============================================================================

import * as PIXI from 'pixi.js';

export type SelectionMode = 'rectangle' | 'lasso' | 'ellipse';
export type SelectionOperation = 'new' | 'add' | 'subtract' | 'intersect';

export class SelectionTool {
    private graphics: PIXI.Graphics | null = null;
    private mode: SelectionMode = 'rectangle';
    private operation: SelectionOperation = 'new';
    private isSelecting: boolean = false;
    private startPoint: { x: number; y: number } | null = null;
    private currentPath: { x: number; y: number }[] = [];

    // Stored selections for composite operations
    private storedSelections: { x: number; y: number }[][] = [];

    // Marching ants animation
    private dashOffset: number = 0;
    private animationFrame: number | null = null;

    /**
     * Initialize selection tool
     */
    init(container: PIXI.Container): void {
        this.graphics = new PIXI.Graphics();
        this.graphics.zIndex = 9999; // Always on top
        container.addChild(this.graphics);

        // Start marching ants animation
        this.animateMarchingAnts();
    }

    /**
     * Set selection mode
     */
    setMode(mode: SelectionMode): void {
        this.mode = mode;
    }

    /**
     * Set selection operation (new, add, subtract, intersect)
     */
    setOperation(operation: SelectionOperation): void {
        this.operation = operation;
    }

    /**
     * Get current operation
     */
    getOperation(): SelectionOperation {
        return this.operation;
    }

    /**
     * Start selection
     */
    startSelection(x: number, y: number): void {
        this.isSelecting = true;
        this.startPoint = { x, y };
        this.currentPath = [{ x, y }];
        this.clear();
    }

    /**
     * Update selection as user drags
     */
    updateSelection(x: number, y: number): void {
        if (!this.isSelecting || !this.startPoint || !this.graphics) return;

        if (this.mode === 'rectangle') {
            // Rectangle: only need start and current point
            this.currentPath = [
                this.startPoint,
                { x, y: this.startPoint.y },
                { x, y },
                { x: this.startPoint.x, y },
                this.startPoint // Close path
            ];
        } else if (this.mode === 'ellipse') {
            // Generate ellipse path
            const cx = (this.startPoint.x + x) / 2;
            const cy = (this.startPoint.y + y) / 2;
            const rx = Math.abs(x - this.startPoint.x) / 2;
            const ry = Math.abs(y - this.startPoint.y) / 2;

            this.currentPath = [];
            const steps = 64;
            for (let i = 0; i <= steps; i++) {
                const angle = (i / steps) * Math.PI * 2;
                this.currentPath.push({
                    x: cx + rx * Math.cos(angle),
                    y: cy + ry * Math.sin(angle)
                });
            }
        } else if (this.mode === 'lasso') {
            // Freeform: add point to path
            this.currentPath.push({ x, y });
        }

        this.drawSelection();
    }

    /**
     * End selection and apply composite operation
     */
    endSelection(): { x: number; y: number }[] {
        this.isSelecting = false;

        // Close lasso path
        if (this.mode === 'lasso' && this.currentPath.length > 2) {
            this.currentPath.push(this.currentPath[0]);
        }

        // Apply composite operation
        if (this.operation === 'new' || this.storedSelections.length === 0) {
            // New selection replaces everything
            this.storedSelections = [this.currentPath];
        } else if (this.operation === 'add') {
            // Add: combine current with stored selections
            this.storedSelections.push(this.currentPath);
        } else if (this.operation === 'subtract') {
            // Subtract: mark for exclusion (handled in mask generation)
            this.storedSelections.push(this.currentPath.map(p => ({ ...p, subtract: true } as any)));
        } else if (this.operation === 'intersect') {
            // Intersect: keep only overlapping area (simplified - actual implementation needs polygon intersection)
            // For now, store both and let mask generation handle it
            this.storedSelections = [this.currentPath];
        }

        const path = [...this.currentPath];
        this.startPoint = null;

        return path;
    }

    /**
     * Get all stored selections (for composite mask generation)
     */
    getAllSelections(): { x: number; y: number }[][] {
        return [...this.storedSelections];
    }

    /**
     * Clear all stored selections
     */
    clearStoredSelections(): void {
        this.storedSelections = [];
    }

    /**
     * Draw the selection with marching ants effect
     */
    private drawSelection(): void {
        if (!this.graphics || this.currentPath.length < 2) return;

        this.graphics.clear();

        // White background stroke
        this.graphics.setStrokeStyle({
            width: 1,
            color: 0xffffff,
            alpha: 1
        });
        this.drawPath();
        this.graphics.stroke();

        // Black dashed stroke (marching ants)
        this.graphics.setStrokeStyle({
            width: 1,
            color: 0x000000,
            alpha: 1
        });
        // Note: Pixi.js doesn't have native dash support, 
        // so we simulate with solid line + animation
        this.drawPath();
        this.graphics.stroke();
    }

    /**
     * Draw the current path
     */
    private drawPath(): void {
        if (!this.graphics || this.currentPath.length < 2) return;

        this.graphics.moveTo(this.currentPath[0].x, this.currentPath[0].y);
        for (let i = 1; i < this.currentPath.length; i++) {
            this.graphics.lineTo(this.currentPath[i].x, this.currentPath[i].y);
        }
    }

    /**
     * Animate marching ants (for visual feedback)
     */
    private animateMarchingAnts(): void {
        const animate = () => {
            this.dashOffset = (this.dashOffset + 0.5) % 10;
            if (this.currentPath.length > 1) {
                this.drawSelection();
            }
            this.animationFrame = requestAnimationFrame(animate);
        };
        animate();
    }

    /**
     * Clear selection
     */
    clear(): void {
        this.graphics?.clear();
        this.currentPath = [];
    }

    /**
     * Get current selection path
     */
    getPath(): { x: number; y: number }[] {
        return [...this.currentPath];
    }

    /**
     * Get selection bounds
     */
    getBounds(): { x: number; y: number; width: number; height: number } | null {
        if (this.currentPath.length < 2) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const p of this.currentPath) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Generate a mask image from selection
     */
    generateMask(width: number, height: number): string | null {
        if (this.currentPath.length < 3) return null;

        // Create canvas for mask
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Fill black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        // Draw selection path in white
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
        for (let i = 1; i < this.currentPath.length; i++) {
            ctx.lineTo(this.currentPath[i].x, this.currentPath[i].y);
        }
        ctx.closePath();
        ctx.fill();

        return canvas.toDataURL('image/png');
    }

    /**
     * Cleanup
     */
    destroy(): void {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.graphics?.destroy();
        this.graphics = null;
    }
}

export const selectionTool = new SelectionTool();
