/**
 * AssetLibraryService - Persistent storage for visual assets
 * Supports characters, environments, and props with embedding-based search
 * Inspired by KlingAI's Element Library (up to 7 reference images per character)
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Asset types supported in the library
export type AssetRole = 'character' | 'environment' | 'prop';

export interface AssetReference {
    id: string;
    name: string;
    role: AssetRole;
    description?: string;
    referenceImages: string[];  // Up to 7 images for consistency (per Kling research)
    tags: string[];
    createdAt: string;
    updatedAt: string;
    // Metadata for generation
    style?: string;
    defaultPromptPrefix?: string;  // e.g., "@Alex, a 30-year-old man with..."
}

interface AssetLibraryConfig {
    dataPath?: string;
}

export class AssetLibraryService {
    private assetsPath: string;
    private cache: Map<string, AssetReference> = new Map();

    constructor(config?: AssetLibraryConfig) {
        this.assetsPath = config?.dataPath || path.resolve(process.cwd(), 'data/assets/library');
        this.ensureDirectories();
        this.loadAssets();
        console.log(`[AssetLibrary] Initialized with ${this.cache.size} assets`);
    }

    private ensureDirectories(): void {
        const dirs = [
            this.assetsPath,
            path.join(this.assetsPath, 'characters'),
            path.join(this.assetsPath, 'environments'),
            path.join(this.assetsPath, 'props'),
            path.join(this.assetsPath, 'images')
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    /**
     * Load all assets from disk into cache
     */
    private loadAssets(): void {
        const roles: AssetRole[] = ['character', 'environment', 'prop'];

        for (const role of roles) {
            const rolePath = path.join(this.assetsPath, `${role}s`);
            if (!fs.existsSync(rolePath)) continue;

            const files = fs.readdirSync(rolePath).filter(f => f.endsWith('.json'));

            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(rolePath, file), 'utf-8');
                    const asset: AssetReference = JSON.parse(content);
                    this.cache.set(asset.id, asset);
                } catch (e) {
                    console.error(`[AssetLibrary] Failed to load asset: ${file}`, e);
                }
            }
        }
    }

    /**
     * Create a new asset
     */
    public async createAsset(input: {
        name: string;
        role: AssetRole;
        description?: string;
        referenceImages?: string[];
        tags?: string[];
        style?: string;
        defaultPromptPrefix?: string;
    }): Promise<AssetReference> {
        const asset: AssetReference = {
            id: uuidv4(),
            name: input.name,
            role: input.role,
            description: input.description || '',
            referenceImages: input.referenceImages || [],
            tags: input.tags || [],
            style: input.style,
            defaultPromptPrefix: input.defaultPromptPrefix,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await this.saveAsset(asset);
        return asset;
    }

    /**
     * Save asset to disk and cache
     */
    public async saveAsset(asset: AssetReference): Promise<void> {
        const rolePath = path.join(this.assetsPath, `${asset.role}s`);
        const filePath = path.join(rolePath, `${asset.id}.json`);

        asset.updatedAt = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(asset, null, 2));
        this.cache.set(asset.id, asset);

        console.log(`[AssetLibrary] Saved ${asset.role}: ${asset.name} (${asset.id})`);
    }

    /**
     * Get asset by ID
     */
    public getAsset(id: string): AssetReference | undefined {
        return this.cache.get(id);
    }

    /**
     * Get asset by name (case-insensitive)
     */
    public getAssetByName(name: string): AssetReference | undefined {
        const normalizedName = name.toLowerCase().replace('@', '');

        for (const asset of this.cache.values()) {
            if (asset.name.toLowerCase() === normalizedName) {
                return asset;
            }
        }
        return undefined;
    }

    /**
     * Get all assets of a specific role
     */
    public getAssetsByRole(role: AssetRole): AssetReference[] {
        return Array.from(this.cache.values()).filter(a => a.role === role);
    }

    /**
     * Get all assets
     */
    public getAllAssets(): AssetReference[] {
        return Array.from(this.cache.values());
    }

    /**
     * Search assets by tag
     */
    public searchByTag(tag: string): AssetReference[] {
        const normalizedTag = tag.toLowerCase();
        return Array.from(this.cache.values()).filter(
            a => a.tags.some(t => t.toLowerCase().includes(normalizedTag))
        );
    }

    /**
     * Add reference image to an asset (max 7 per Kling research)
     */
    public async addReferenceImage(assetId: string, imageUrl: string): Promise<boolean> {
        const asset = this.cache.get(assetId);
        if (!asset) return false;

        if (asset.referenceImages.length >= 7) {
            console.warn(`[AssetLibrary] Asset ${asset.name} already has 7 reference images`);
            return false;
        }

        asset.referenceImages.push(imageUrl);
        await this.saveAsset(asset);
        return true;
    }

    /**
     * Parse @mentions in prompt and resolve to assets
     * Example: "A video of @Alex walking through @ForestEnv"
     * Returns enhanced prompt with asset descriptions
     */
    public resolveAssetMentions(prompt: string): {
        enhancedPrompt: string;
        resolvedAssets: AssetReference[];
    } {
        const mentionRegex = /@(\w+)/g;
        const resolvedAssets: AssetReference[] = [];

        let enhancedPrompt = prompt;
        let match;

        while ((match = mentionRegex.exec(prompt)) !== null) {
            const assetName = match[1];
            const asset = this.getAssetByName(assetName);

            if (asset) {
                resolvedAssets.push(asset);

                // Replace @mention with detailed description
                const replacement = asset.defaultPromptPrefix ||
                    `${asset.name}${asset.description ? `, ${asset.description}` : ''}`;

                enhancedPrompt = enhancedPrompt.replace(`@${assetName}`, replacement);

                console.log(`[AssetLibrary] Resolved @${assetName} → ${replacement.substring(0, 50)}...`);
            } else {
                console.warn(`[AssetLibrary] Asset not found: @${assetName}`);
            }
        }

        return { enhancedPrompt, resolvedAssets };
    }

    /**
     * Delete an asset
     */
    public async deleteAsset(id: string): Promise<boolean> {
        const asset = this.cache.get(id);
        if (!asset) return false;

        const filePath = path.join(this.assetsPath, `${asset.role}s`, `${id}.json`);

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            this.cache.delete(id);
            console.log(`[AssetLibrary] Deleted ${asset.role}: ${asset.name}`);
            return true;
        } catch (e) {
            console.error(`[AssetLibrary] Failed to delete asset:`, e);
            return false;
        }
    }

    /**
     * Get statistics about the library
     */
    public getStats(): { total: number; characters: number; environments: number; props: number } {
        const all = Array.from(this.cache.values());
        return {
            total: all.length,
            characters: all.filter(a => a.role === 'character').length,
            environments: all.filter(a => a.role === 'environment').length,
            props: all.filter(a => a.role === 'prop').length
        };
    }
}

export const assetLibrary = new AssetLibraryService();
