// =============================================================================
// Nexus Canvas - Pixi.js Engine
// WebGL rendering engine for the canvas editor
// =============================================================================

import * as PIXI from 'pixi.js';
import type { CanvasLayer, BlendMode, ViewportState, LayerMask, LayerAdjustments, LayerEffects } from '../../../types/canvas';

// Blend mode mapping from our types to Pixi v8 string values
const BLEND_MODE_MAP: Record<BlendMode, string> = {
    'NORMAL': 'normal',
    'MULTIPLY': 'multiply',
    'SCREEN': 'screen',
    'OVERLAY': 'overlay',
    'DARKEN': 'darken',
    'LIGHTEN': 'lighten',
    'COLOR_DODGE': 'color-dodge',
    'COLOR_BURN': 'color-burn',
    'HARD_LIGHT': 'hard-light',
    'SOFT_LIGHT': 'soft-light',
    'DIFFERENCE': 'difference',
    'EXCLUSION': 'exclusion',
    'HUE': 'hue',
    'SATURATION': 'saturation',
    'COLOR': 'color',
    'LUMINOSITY': 'luminosity'
};

export class CanvasEngine {
    private app: PIXI.Application | null = null;
    private layerContainer: PIXI.Container | null = null;
    private selectionGraphics: PIXI.Graphics | null = null;

    // Store Containers or Sprites. Map<ID, Object>
    private layerObjects: Map<string, PIXI.Container> = new Map();

    private shadowSprites: Map<string, PIXI.Sprite> = new Map();
    private clippingMaskSprites: Map<string, PIXI.Sprite> = new Map();
    private vectorMasks: Map<string, PIXI.Graphics> = new Map();

    private canvasWidth: number = 1920;
    private canvasHeight: number = 1080;

    private isDestroyed: boolean = false;
    private isInitializing: boolean = false;

    async init(
        canvas: HTMLCanvasElement,
        width: number = 1920,
        height: number = 1080
    ): Promise<void> {
        if (this.isInitializing || this.isDestroyed) return;

        this.isInitializing = true;
        this.canvasWidth = width;
        this.canvasHeight = height;

        try {
            this.app = new PIXI.Application();
            await this.app.init({
                canvas,
                width: canvas.clientWidth,
                height: canvas.clientHeight,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
                backgroundColor: 0x1a1a2e,
                antialias: true
            });

            if (this.isDestroyed) {
                this.app.destroy(true);
                this.app = null;
                return;
            }

            canvas.setAttribute('data-nexus-canvas', 'true');

            this.layerContainer = new PIXI.Container();
            this.layerContainer.sortableChildren = true;
            this.app.stage.addChild(this.layerContainer);

            this.selectionGraphics = new PIXI.Graphics();
            this.app.stage.addChild(this.selectionGraphics);

            this.centerCanvas();
            console.log('[CanvasEngine] Initialized with WebGL');
        } catch (e: any) {
            console.error('[CanvasEngine] Init failed:', e.message);
        } finally {
            this.isInitializing = false;
        }
    }

    private centerCanvas(): void {
        if (!this.app || !this.layerContainer) return;

        const viewWidth = this.app.screen.width;
        const viewHeight = this.app.screen.height;

        this.layerContainer.x = (viewWidth - this.canvasWidth) / 2;
        this.layerContainer.y = (viewHeight - this.canvasHeight) / 2;
    }

    resize(width: number, height: number): void {
        if (!this.app) return;
        this.app.renderer.resize(width, height);
        this.centerCanvas();
    }

    updateViewport(viewport: ViewportState): void {
        if (!this.layerContainer || !this.app) return;

        const screenCenterX = this.app.screen.width / 2;
        const screenCenterY = this.app.screen.height / 2;

        this.layerContainer.scale.set(viewport.zoom);
        this.layerContainer.x = screenCenterX - (this.canvasWidth / 2) * viewport.zoom + viewport.panX;
        this.layerContainer.y = screenCenterY - (this.canvasHeight / 2) * viewport.zoom + viewport.panY;
    }

    /**
     * Render layers recursively
     */
    async renderLayers(layers: CanvasLayer[], isLowPerformanceMode: boolean = false): Promise<void> {
        if (!this.layerContainer) return;

        // 1. Collect all active IDs recursively
        const activeIds = new Set<string>();
        this.collectIds(layers, activeIds);

        // 2. Cleanup missing objects
        for (const [id, object] of this.layerObjects) {
            if (!activeIds.has(id)) {
                object.destroy({ children: true }); // Clean Pixi subtree
                this.layerObjects.delete(id);

                // Shadows
                const shadow = this.shadowSprites.get(id);
                if (shadow) {
                    shadow.destroy();
                    this.shadowSprites.delete(id);
                }

                // Masks
                const clip = this.clippingMaskSprites.get(id);
                if (clip) {
                    clip.destroy();
                    this.clippingMaskSprites.delete(id);
                }

                const vecMask = this.vectorMasks.get(id);
                if (vecMask) {
                    vecMask.destroy();
                    this.vectorMasks.delete(id);
                }
            }
        }

        // 3. Render Tree
        await this.renderRecursive(layers, this.layerContainer, isLowPerformanceMode);

        // 4. Sort Root
        this.layerContainer.sortChildren();
    }

    private collectIds(layers: CanvasLayer[], ids: Set<string>) {
        for (const layer of layers) {
            ids.add(layer.id);
            if (layer.layers) {
                this.collectIds(layer.layers, ids);
            }
        }
    }

    private createAdjustmentFilter(layer: CanvasLayer): PIXI.Filter | null {
        if (!layer.adjustmentType) return null;

        const filter = new PIXI.ColorMatrixFilter();
        const { brightness, contrast, saturation, hue } = layer.adjustments;

        if (layer.adjustmentType === 'brightness') {
            if (brightness !== 0) filter.brightness(1 + brightness / 100, false);
            if (contrast !== 0) filter.contrast(1 + contrast / 100, false);
        } else if (layer.adjustmentType === 'hue') {
            if (hue !== 0) filter.hue(hue, false);
            if (saturation !== 0) filter.saturate(1 + saturation / 100, false);
        }

        return filter;
    }

    private async renderRecursive(layers: CanvasLayer[], parent: PIXI.Container, isLowPerformanceMode: boolean) {
        // "Wrapping" Strategy for Adjustment Layers
        let currentContainer = new PIXI.Container();
        parent.addChild(currentContainer);

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];

            // 1. Adjustment Layer Logic
            if (layer.type === 'adjustment') {
                if (layer.visible && layer.adjustmentType) {
                    const filter = this.createAdjustmentFilter(layer);
                    if (filter) {
                        currentContainer.filters = [filter];
                        const wrapper = new PIXI.Container();
                        parent.addChild(wrapper);
                        wrapper.addChild(currentContainer);
                        currentContainer = wrapper;
                    }
                }
                continue;
            }

            // 2. Group Logic
            if (layer.type === 'group') {
                if (layer.visible) {
                    const groupContainer = this.layerObjects.get(layer.id) || new PIXI.Container();
                    if (!this.layerObjects.has(layer.id)) this.layerObjects.set(layer.id, groupContainer);

                    groupContainer.alpha = layer.opacity / 100;
                    groupContainer.visible = true;
                    groupContainer.position.set(layer.transform.x, layer.transform.y);
                    groupContainer.rotation = layer.transform.rotation;
                    groupContainer.scale.set(layer.transform.scaleX, layer.transform.scaleY);
                    groupContainer.removeChildren();

                    currentContainer.addChild(groupContainer);

                    if (layer.layers) {
                        await this.renderRecursive(layer.layers, groupContainer, isLowPerformanceMode);
                    }
                }
                continue;
            }

            // 3. Leaf Layer Logic
            if (!layer.visible) {
                if (this.layerObjects.has(layer.id)) {
                    const obj = this.layerObjects.get(layer.id);
                    if (obj) obj.visible = false;
                }
                continue;
            }

            let sprite = this.layerObjects.get(layer.id) as PIXI.Sprite;
            if (!sprite) {
                if (layer.type === 'text') {
                    const text = new PIXI.Text(layer.name, { fontSize: 24, fill: 0xffffff });
                    sprite = text as unknown as PIXI.Sprite;
                } else if (layer.type === 'vector') {
                    const gfx = new PIXI.Graphics();
                    gfx.rect(0, 0, 100, 100).fill(0xff0000);
                    sprite = gfx as unknown as PIXI.Sprite;
                } else {
                    sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                }
                this.layerObjects.set(layer.id, sprite);
            }

            // Texture Update
            if (layer.type === 'raster' && layer.imageData) {
                if (sprite.texture === PIXI.Texture.WHITE && layer.imageData.startsWith('data:')) {
                    PIXI.Assets.load(layer.imageData).then(tex => sprite.texture = tex);
                }
            }

            // Properties
            sprite.visible = true;
            sprite.alpha = layer.opacity / 100;
            sprite.blendMode = (BLEND_MODE_MAP[layer.blendMode] || 'normal') as any;
            sprite.position.set(layer.transform.x, layer.transform.y);
            sprite.rotation = layer.transform.rotation;
            sprite.scale.set(layer.transform.scaleX, layer.transform.scaleY);

            // Masking
            if (layer.vectorMask && layer.vectorMask.enabled && layer.vectorMask.path.length > 2) {
                let maskGraphics = this.vectorMasks.get(layer.id);
                if (!maskGraphics) {
                    maskGraphics = new PIXI.Graphics();
                    this.vectorMasks.set(layer.id, maskGraphics);
                }
                if (maskGraphics.parent !== currentContainer) currentContainer.addChild(maskGraphics);

                maskGraphics.clear();
                maskGraphics.context.beginPath();
                const path = layer.vectorMask.path;
                maskGraphics.context.moveTo(path[0].x, path[0].y);
                for (let k = 1; k < path.length; k++) maskGraphics.context.lineTo(path[k].x, path[k].y);
                maskGraphics.context.closePath();
                maskGraphics.context.fill(0xffffff);

                sprite.mask = maskGraphics;
                if (this.clippingMaskSprites.has(layer.id)) { this.clippingMaskSprites.get(layer.id)?.destroy(); this.clippingMaskSprites.delete(layer.id); }

            } else if (layer.clippingMaskId) {
                if (this.vectorMasks.has(layer.id)) { this.vectorMasks.get(layer.id)?.destroy(); this.vectorMasks.delete(layer.id); }

                const baseObject = this.layerObjects.get(layer.clippingMaskId);
                if (baseObject && baseObject instanceof PIXI.Sprite) {
                    let clone = this.clippingMaskSprites.get(layer.id);
                    if (!clone) {
                        clone = new PIXI.Sprite(baseObject.texture);
                        this.clippingMaskSprites.set(layer.id, clone);
                    }
                    clone.texture = baseObject.texture;

                    clone.position.copyFrom(baseObject.position);
                    clone.rotation = baseObject.rotation;
                    clone.scale.copyFrom(baseObject.scale);
                    clone.anchor.copyFrom(baseObject.anchor);

                    currentContainer.addChild(clone);
                    sprite.mask = clone;
                } else {
                    sprite.mask = null;
                }
            } else {
                sprite.mask = null;
                if (this.clippingMaskSprites.has(layer.id)) { this.clippingMaskSprites.get(layer.id)?.destroy(); this.clippingMaskSprites.delete(layer.id); }
                if (this.vectorMasks.has(layer.id)) { this.vectorMasks.get(layer.id)?.destroy(); this.vectorMasks.delete(layer.id); }
            }

            // Adjustments Helper call
            if (layer.adjustments) {
                this.applyAdjustments(sprite, layer.adjustments);
            } else {
                if (sprite.filters) {
                    sprite.filters = sprite.filters.filter(f => !(f instanceof PIXI.ColorMatrixFilter));
                }
            }

            currentContainer.addChild(sprite);

            // Shadow
            if (layer.effects && layer.effects.dropShadow && layer.effects.dropShadow.enabled) {
                let shadowSprite = this.shadowSprites.get(layer.id);
                if (!shadowSprite) {
                    shadowSprite = new PIXI.Sprite(sprite.texture);
                    shadowSprite.anchor.copyFrom(sprite.anchor);
                    this.shadowSprites.set(layer.id, shadowSprite);
                }
                if (shadowSprite.parent !== currentContainer) currentContainer.addChildAt(shadowSprite, currentContainer.getChildIndex(sprite)); // Behind sprite

                this.updateShadow(shadowSprite, sprite, layer.effects.dropShadow, isLowPerformanceMode);
                shadowSprite.visible = true; // Use loop visibility?
                // Shadow transform sync
                shadowSprite.position.set(
                    sprite.x + (layer.effects.dropShadow.x || 0),
                    sprite.y + (layer.effects.dropShadow.y || 0)
                );
                shadowSprite.rotation = sprite.rotation;
                shadowSprite.scale.copyFrom(sprite.scale);
            } else {
                if (this.shadowSprites.has(layer.id)) {
                    this.shadowSprites.get(layer.id)?.destroy();
                    this.shadowSprites.delete(layer.id);
                }
            }
        }
    }

    private async createLayerSprite(layer: CanvasLayer): Promise<PIXI.Sprite | null> {
        if (layer.imageData) {
            const texture = await PIXI.Assets.load(layer.imageData);
            return new PIXI.Sprite(texture);
        }
        // Placeholder
        const g = new PIXI.Graphics().rect(0, 0, this.canvasWidth, this.canvasHeight).fill(0xffffff);
        const t = this.app?.renderer.generateTexture(g);
        g.destroy();
        return t ? new PIXI.Sprite(t) : null;
    }

    drawSelection(path: { x: number; y: number }[]): void {
        if (!this.selectionGraphics) return;
        this.selectionGraphics.clear();
        if (path.length < 2) return;
        this.selectionGraphics.setStrokeStyle({ width: 1, color: 0x00ffff, alpha: 1 });
        this.selectionGraphics.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) this.selectionGraphics.lineTo(path[i].x, path[i].y);
        this.selectionGraphics.closePath();
        this.selectionGraphics.stroke();
    }

    clearSelection(): void { this.selectionGraphics?.clear(); }

    async exportAsBase64(): Promise<string> {
        if (!this.app || !this.layerContainer) return '';
        const rt = PIXI.RenderTexture.create({ width: this.canvasWidth, height: this.canvasHeight });
        this.app.renderer.render({ container: this.layerContainer, target: rt });
        const canvas = this.app.renderer.extract.canvas(rt);
        if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/png');
        const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
        return new Promise(r => { const reader = new FileReader(); reader.onloadend = () => r(reader.result as string); reader.readAsDataURL(blob); });
    }

    getSelectionBounds(path: { x: number; y: number }[]): { x: number; y: number; width: number; height: number } | null {
        if (path.length < 2) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of path) {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    private applyAdjustments(sprite: PIXI.Sprite, adj: LayerAdjustments) {
        let filter = (sprite.filters || []).find(f => f instanceof PIXI.ColorMatrixFilter) as PIXI.ColorMatrixFilter;
        if (!filter) {
            filter = new PIXI.ColorMatrixFilter();
            sprite.filters = [...(sprite.filters || []), filter];
        }
        filter.reset();
        if (adj.brightness !== 0) filter.brightness(1 + adj.brightness / 100, false); // consistency
        if (adj.contrast !== 0) filter.contrast(1 + adj.contrast / 100, false);
        if (adj.saturation !== 0) filter.saturate(1 + adj.saturation / 100, false);
        if (adj.hue !== 0) filter.hue(adj.hue, false);
    }

    private updateShadow(shadow: PIXI.Sprite, source: PIXI.Sprite, effect: NonNullable<NonNullable<LayerEffects>['dropShadow']>, isLowPerformanceMode: boolean) {
        if (shadow.texture !== source.texture) shadow.texture = source.texture;
        shadow.tint = effect.color;
        shadow.alpha = effect.opacity;
        let blurFilter = (shadow.filters || []).find(f => f instanceof PIXI.BlurFilter) as PIXI.BlurFilter;
        if (!blurFilter) {
            blurFilter = new PIXI.BlurFilter();
            shadow.filters = [...(shadow.filters || []), blurFilter];
        }
        if (isLowPerformanceMode && effect.blur > 0) {
            blurFilter.quality = 1; blurFilter.blur = Math.min(effect.blur, 5);
        } else {
            blurFilter.quality = 4; blurFilter.blur = effect.blur;
        }
    }

    private async applyMaskToSprite(sprite: PIXI.Sprite, mask: LayerMask): Promise<void> {
        try {
            const texture = await PIXI.Assets.load(mask.imageData);
            const maskSprite = new PIXI.Sprite(texture);
            maskSprite.width = sprite.texture.width;
            maskSprite.height = sprite.texture.height;
            sprite.addChild(maskSprite);
            sprite.mask = maskSprite;
        } catch (e) { console.warn('[CanvasEngine] Mask failed:', e); }
    }

    destroy(): void {
        this.isDestroyed = true;
        if (!this.app) return;
        try {
            for (const object of this.layerObjects.values()) object.destroy({ children: true });
            this.layerObjects.clear();
            for (const s of this.shadowSprites.values()) s.destroy();
            this.shadowSprites.clear();
            for (const s of this.clippingMaskSprites.values()) s.destroy();
            this.clippingMaskSprites.clear();
            if (this.app.stage) this.app.destroy(true);
        } catch (e) {
            console.warn('[CanvasEngine] Destroy error:', e);
        }
        this.app = null;
        this.layerContainer = null;
        this.selectionGraphics = null;
        console.log('[CanvasEngine] Destroyed');
    }
}

export const canvasEngine = new CanvasEngine();
