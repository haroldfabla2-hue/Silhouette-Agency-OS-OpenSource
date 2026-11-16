import { ResourceScope } from '../../server/runtime/resourceScope';
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
    private retainDurability<T>(name: string, operation: () => T): T {
        try { return operation(); } catch (error) { this.operations.recordFailure(name, error); throw error; }
    }

    private assetsPath: string;
    private cache: Map<string, AssetReference> = new Map();

    constructor(config?: AssetLibraryConfig) {
        this.assetsPath = config?.dataPath || path.resolve(process.cwd(), 'data/assets/library');

    }

    private readonly operations = new ResourceScope('assetLibrary');
    private started = false;
    private closing = false;
    private readonly recoveryFailures: unknown[] = [];
    public start(): void {
        this.operations.assertWorkAccepted();
        if (this.started) return;
        this.operations.assertAccepting();
        if (this.recoveryFailures.length) throw new AggregateError(this.recoveryFailures, 'Asset recovery unavailable');
        try { this.ensureDirectories(); this.loadAssets(); } catch (error) { this.recoveryFailures.push(error); this.operations.recordFailure('asset-recovery-startup', error); throw error; }
        if (this.recoveryFailures.length) throw new AggregateError(this.recoveryFailures, 'Asset library incomplete recovery; originals retained');
        this.started = true;
    }
    public getLifecycleFailures(): readonly unknown[] { return [...this.recoveryFailures]; }
    public shutdown() { this.closing = true; return this.operations.close(); }

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
                this.retainDurability('assetLibrary.ts:storage', () => fs.mkdirSync(dir, { recursive: true }));
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
                    this.recoveryFailures.push(e);
                    this.operations.recordFailure('asset-recovery-startup', e);
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
        return this.operations.run('createAsset', async () => {

        this.start();

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
    
        });
    }

    /**
     * Save asset to disk and cache
     */
    public async saveAsset(asset: AssetReference): Promise<void> {
        return this.operations.run('saveAsset', async () => {

        this.start();

        const rolePath = path.join(this.assetsPath, `${asset.role}s`);
        const filePath = path.join(rolePath, `${asset.id}.json`);

        asset.updatedAt = new Date().toISOString();

        this.retainDurability('assetLibrary.ts:storage', () => fs.writeFileSync(filePath, JSON.stringify(asset, null, 2)));
        this.cache.set(asset.id, asset);

        console.log(`[AssetLibrary] Saved ${asset.role}: ${asset.name} (${asset.id})`);
    
        });
    }

    /**
     * Get asset by ID
     */
    public getAsset(id: string): AssetReference | undefined {
        this.start();

        return this.cache.get(id);
    }

    /**
     * Get asset by name (case-insensitive)
     */
    public getAssetByName(name: string): AssetReference | undefined {
        this.start();

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
        this.start();

        return Array.from(this.cache.values()).filter(a => a.role === role);
    }

    /**
     * Get all assets
     */
    public getAllAssets(): AssetReference[] {
        this.start();

        return Array.from(this.cache.values());
    }

    /**
     * Search assets by tag
     */
    public searchByTag(tag: string): AssetReference[] {
        this.start();

        const normalizedTag = tag.toLowerCase();
        return Array.from(this.cache.values()).filter(
            a => a.tags.some(t => t.toLowerCase().includes(normalizedTag))
        );
    }

    /**
     * Add reference image to an asset (max 7 per Kling research)
     */
    public async addReferenceImage(assetId: string, imageUrl: string): Promise<boolean> {
        return this.operations.run('addReferenceImage', async () => {

        this.start();

        const asset = this.cache.get(assetId);
        if (!asset) return false;

        if (asset.referenceImages.length >= 7) {
            console.warn(`[AssetLibrary] Asset ${asset.name} already has 7 reference images`);
            return false;
        }

        asset.referenceImages.push(imageUrl);
        await this.saveAsset(asset);
        return true;
    
        });
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
        this.start();

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
        return this.operations.run('deleteAsset', async () => {

        this.start();

        const asset = this.cache.get(id);
        if (!asset) return false;

        const filePath = path.join(this.assetsPath, `${asset.role}s`, `${id}.json`);

        try {
            if (fs.existsSync(filePath)) {
                this.retainDurability('assetLibrary.ts:storage', () => fs.unlinkSync(filePath));
            }
            this.cache.delete(id);
            console.log(`[AssetLibrary] Deleted ${asset.role}: ${asset.name}`);
            return true;
        } catch (e) {
            console.error(`[AssetLibrary] Failed to delete asset:`, e);
            return false;
        }
    
        });
    }

    /**
     * Get statistics about the library
     */
    public getStats(): { total: number; characters: number; environments: number; props: number } {
        this.start();

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
