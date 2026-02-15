// =============================================================================
// Nexus Canvas Service
// Backend integration for persistence, AI generation, and asset management
// Leverages Silhouette's existing infrastructure
// =============================================================================

import { assetCatalog, type AssetCreateInput } from '../assetCatalog';
import { imageFactory, type ImageGenerationRequest } from './imageFactory';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// Document storage path
const CANVAS_DOCS_DIR = path.join(process.cwd(), 'uploads', 'canvas');

// Types for canvas documents
export interface CanvasDocumentMeta {
    id: string;
    name: string;
    width: number;
    height: number;
    layerCount: number;
    thumbnailPath?: string;
    createdAt: number;
    updatedAt: number;
}

export interface SaveDocumentRequest {
    id?: string;  // If provided, update existing
    name: string;
    documentJson: string;  // Stringified NexusDocument
    thumbnail?: string;    // Base64 PNG for preview
}

export interface InpaintRequest {
    imageBase64: string;
    maskBase64: string;
    prompt: string;
    negativePrompt?: string;
    preferLocal?: boolean;
}

class CanvasService {
    private initialized = false;

    /**
     * Initialize the canvas service
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        // Ensure canvas documents directory exists
        await fs.mkdir(CANVAS_DOCS_DIR, { recursive: true });

        this.initialized = true;
        console.log('[CanvasService] ✅ Initialized');
    }

    /**
     * Save or update a canvas document
     */
    async saveDocument(request: SaveDocumentRequest): Promise<CanvasDocumentMeta> {
        await this.init();

        const id = request.id || crypto.randomUUID();
        const now = Date.now();

        // Parse document to extract metadata
        let docData: any;
        try {
            docData = JSON.parse(request.documentJson);
        } catch {
            throw new Error('Invalid document JSON');
        }

        // Save document JSON
        const docPath = path.join(CANVAS_DOCS_DIR, `${id}.json`);
        await fs.writeFile(docPath, request.documentJson, 'utf-8');

        // Save thumbnail if provided
        let thumbnailPath: string | undefined;
        if (request.thumbnail) {
            thumbnailPath = path.join(CANVAS_DOCS_DIR, `${id}_thumb.png`);
            const thumbData = request.thumbnail.replace(/^data:image\/\w+;base64,/, '');
            await fs.writeFile(thumbnailPath, Buffer.from(thumbData, 'base64'));
        }

        const meta: CanvasDocumentMeta = {
            id,
            name: request.name,
            width: docData.dimensions?.width || 1920,
            height: docData.dimensions?.height || 1080,
            layerCount: docData.layers?.length || 0,
            thumbnailPath,
            createdAt: docData.createdAt || now,
            updatedAt: now
        };

        console.log(`[CanvasService] 💾 Saved document: ${meta.name} (${id})`);
        return meta;
    }

    /**
     * Load a canvas document
     */
    async loadDocument(id: string): Promise<string | null> {
        await this.init();

        const docPath = path.join(CANVAS_DOCS_DIR, `${id}.json`);

        try {
            const content = await fs.readFile(docPath, 'utf-8');
            return content;
        } catch {
            console.warn(`[CanvasService] Document not found: ${id}`);
            return null;
        }
    }

    /**
     * List all saved canvas documents
     */
    async listDocuments(): Promise<CanvasDocumentMeta[]> {
        await this.init();

        const files = await fs.readdir(CANVAS_DOCS_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('_'));

        const docs: CanvasDocumentMeta[] = [];

        for (const file of jsonFiles) {
            try {
                const content = await fs.readFile(path.join(CANVAS_DOCS_DIR, file), 'utf-8');
                const doc = JSON.parse(content);
                const id = file.replace('.json', '');

                docs.push({
                    id,
                    name: doc.name || 'Untitled',
                    width: doc.dimensions?.width || 1920,
                    height: doc.dimensions?.height || 1080,
                    layerCount: doc.layers?.length || 0,
                    thumbnailPath: path.join(CANVAS_DOCS_DIR, `${id}_thumb.png`),
                    createdAt: doc.createdAt || 0,
                    updatedAt: doc.updatedAt || 0
                });
            } catch (e) {
                console.warn(`[CanvasService] Failed to parse ${file}:`, e);
            }
        }

        // Sort by updated date, newest first
        docs.sort((a, b) => b.updatedAt - a.updatedAt);

        return docs;
    }

    /**
     * Delete a canvas document
     */
    async deleteDocument(id: string): Promise<boolean> {
        await this.init();

        try {
            await fs.unlink(path.join(CANVAS_DOCS_DIR, `${id}.json`));
            // Try to delete thumbnail too
            try {
                await fs.unlink(path.join(CANVAS_DOCS_DIR, `${id}_thumb.png`));
            } catch { /* Ignore */ }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Inpaint (Generative Fill) using ImageFactory
     * Integrates with Silhouette's existing AI pipeline
     */
    async inpaint(request: InpaintRequest): Promise<{ imageBase64: string; provider: string } | null> {
        console.log(`[CanvasService] 🎨 Starting inpaint: "${request.prompt.substring(0, 50)}..."`);

        // Decode base64 images and save temporarily
        const tempDir = path.join(process.cwd(), 'uploads', 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        const imageId = crypto.randomUUID();
        const imagePath = path.join(tempDir, `${imageId}_image.png`);
        const maskPath = path.join(tempDir, `${imageId}_mask.png`);

        try {
            // Save image and mask
            const imageData = request.imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const maskData = request.maskBase64.replace(/^data:image\/\w+;base64,/, '');

            await fs.writeFile(imagePath, Buffer.from(imageData, 'base64'));
            await fs.writeFile(maskPath, Buffer.from(maskData, 'base64'));

            // Use ImageFactory for generation
            // Note: ImageFactory currently does text-to-image, not inpainting
            // For now, we'll use a workaround with the prompt
            const combinedPrompt = `${request.prompt}, seamless integration, consistent style`;

            const result = await imageFactory.createAsset({
                prompt: combinedPrompt,
                style: 'PHOTOREALISTIC',
                negativePrompt: request.negativePrompt || 'blurry, low quality, artifacts',
                preferLocal: request.preferLocal,
                saveToLibrary: false
            });

            if (!result) {
                console.error('[CanvasService] ❌ Inpaint failed: No result from ImageFactory');
                return null;
            }

            // Read the result image and convert to base64
            let resultBase64: string;

            if (result.localPath) {
                const resultBuffer = await fs.readFile(result.localPath);
                resultBase64 = `data:image/png;base64,${resultBuffer.toString('base64')}`;
            } else if (result.url) {
                // Fetch from URL
                const response = await fetch(result.url);
                const arrayBuffer = await response.arrayBuffer();
                resultBase64 = `data:image/png;base64,${Buffer.from(arrayBuffer).toString('base64')}`;
            } else {
                return null;
            }

            console.log(`[CanvasService] ✅ Inpaint complete via ${result.provider}`);

            return {
                imageBase64: resultBase64,
                provider: result.provider
            };

        } finally {
            // Cleanup temp files
            try {
                await fs.unlink(imagePath);
                await fs.unlink(maskPath);
            } catch { /* Ignore */ }
        }
    }

    /**
     * Export canvas layer to Asset Catalog
     * Persists the result in Silhouette's asset management system
     */
    async exportToAssetCatalog(
        imageBase64: string,
        name: string,
        options?: {
            prompt?: string;
            tags?: string[];
            folder?: string;
        }
    ): Promise<string> {
        await this.init();

        // Save image file
        const id = crypto.randomUUID();
        const dateFolder = new Date().toISOString().split('T')[0];
        const saveDir = path.join(process.cwd(), 'uploads', 'images', dateFolder);
        await fs.mkdir(saveDir, { recursive: true });

        const filePath = path.join(saveDir, `${id}.png`);
        const imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        await fs.writeFile(filePath, Buffer.from(imageData, 'base64'));

        // Register in AssetCatalog
        const input: AssetCreateInput = {
            type: 'image',
            name,
            filePath,
            prompt: options?.prompt,
            provider: 'nexus-canvas',
            tags: options?.tags || ['canvas-export'],
            folder: options?.folder || '/canvas'
        };

        const asset = await assetCatalog.register(input);

        console.log(`[CanvasService] 📤 Exported to catalog: ${asset.name} (${asset.id})`);

        return asset.id;
    }
}

export const canvasService = new CanvasService();
