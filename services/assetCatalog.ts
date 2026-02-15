/**
 * AssetCatalog - Unified Asset Management Service
 * 
 * Provides CRUD operations for all generated assets (images, videos, audio, documents)
 * with SQLite persistence, search, tagging, and folder organization.
 */

import { sqliteService } from './sqliteService';
import * as fs from 'fs/promises';
import * as path from 'path';
import crypto from 'crypto';

export type AssetType = 'image' | 'video' | 'audio' | 'document';

export interface Asset {
    id: string;
    type: AssetType;
    name: string;
    description?: string;
    filePath: string;
    thumbnailPath?: string;
    sizeBytes?: number;
    mimeType?: string;
    prompt?: string;
    provider?: string;
    tags: string[];
    metadata: Record<string, any>;
    folder: string;
    isFavorite: boolean;
    isArchived: boolean;
    createdAt: number;
    updatedAt?: number;
    accessedAt?: number;
}

export interface AssetCreateInput {
    type: AssetType;
    name: string;
    filePath: string;
    description?: string;
    prompt?: string;
    provider?: string;
    tags?: string[];
    metadata?: Record<string, any>;
    folder?: string;
}

export interface AssetSearchOptions {
    type?: AssetType;
    folder?: string;
    tags?: string[];
    query?: string;
    isFavorite?: boolean;
    isArchived?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: 'created_at' | 'name' | 'size_bytes';
    sortOrder?: 'asc' | 'desc';
}

class AssetCatalogService {
    private db: any;

    constructor() {
        this.db = (sqliteService as any).db;
    }

    /**
     * Register a new asset in the catalog
     */
    public async register(input: AssetCreateInput): Promise<Asset> {
        const id = crypto.randomUUID();
        const now = Date.now();

        // Get file stats
        let sizeBytes = 0;
        let mimeType = '';
        try {
            const stats = await fs.stat(input.filePath);
            sizeBytes = stats.size;
            mimeType = this.getMimeType(input.filePath);
        } catch (e) {
            console.warn('[AssetCatalog] Could not get file stats:', e);
        }

        const asset: Asset = {
            id,
            type: input.type,
            name: input.name,
            description: input.description,
            filePath: input.filePath,
            thumbnailPath: undefined,
            sizeBytes,
            mimeType,
            prompt: input.prompt,
            provider: input.provider,
            tags: input.tags || [],
            metadata: input.metadata || {},
            folder: input.folder || '/',
            isFavorite: false,
            isArchived: false,
            createdAt: now,
            updatedAt: now,
            accessedAt: now
        };

        // Generate thumbnail for images/videos
        if (input.type === 'image' || input.type === 'video') {
            asset.thumbnailPath = await this.generateThumbnail(input.filePath, input.type);
        }

        // Insert into DB
        const stmt = this.db.prepare(`
            INSERT INTO assets (
                id, type, name, description, file_path, thumbnail_path,
                size_bytes, mime_type, prompt, provider, tags, metadata,
                folder, is_favorite, is_archived, created_at, updated_at, accessed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            asset.id,
            asset.type,
            asset.name,
            asset.description || null,
            asset.filePath,
            asset.thumbnailPath || null,
            asset.sizeBytes,
            asset.mimeType,
            asset.prompt || null,
            asset.provider || null,
            JSON.stringify(asset.tags),
            JSON.stringify(asset.metadata),
            asset.folder,
            asset.isFavorite ? 1 : 0,
            asset.isArchived ? 1 : 0,
            asset.createdAt,
            asset.updatedAt,
            asset.accessedAt
        );

        console.log(`[AssetCatalog] ✅ Registered: ${asset.name} (${asset.type})`);
        return asset;
    }

    /**
     * Get asset by ID
     */
    public getById(id: string): Asset | null {
        const stmt = this.db.prepare('SELECT * FROM assets WHERE id = ?');
        const row = stmt.get(id);
        if (!row) return null;

        // Update accessed_at
        this.db.prepare('UPDATE assets SET accessed_at = ? WHERE id = ?').run(Date.now(), id);

        return this.rowToAsset(row);
    }

    /**
     * Search assets with filters
     */
    public search(options: AssetSearchOptions = {}): Asset[] {
        let sql = 'SELECT * FROM assets WHERE 1=1';
        const params: any[] = [];

        if (options.type) {
            sql += ' AND type = ?';
            params.push(options.type);
        }

        if (options.folder) {
            sql += ' AND folder = ?';
            params.push(options.folder);
        }

        if (options.isFavorite !== undefined) {
            sql += ' AND is_favorite = ?';
            params.push(options.isFavorite ? 1 : 0);
        }

        if (options.isArchived !== undefined) {
            sql += ' AND is_archived = ?';
            params.push(options.isArchived ? 1 : 0);
        }

        if (options.query) {
            sql += ' AND (name LIKE ? OR description LIKE ? OR prompt LIKE ?)';
            const q = `%${options.query}%`;
            params.push(q, q, q);
        }

        if (options.tags && options.tags.length > 0) {
            // Search for any of the tags in the JSON array
            const tagConditions = options.tags.map(() => 'tags LIKE ?').join(' OR ');
            sql += ` AND (${tagConditions})`;
            options.tags.forEach(tag => params.push(`%"${tag}"%`));
        }

        // Sorting
        const sortBy = options.sortBy || 'created_at';
        const sortOrder = options.sortOrder || 'desc';
        sql += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;

        // Pagination
        if (options.limit) {
            sql += ' LIMIT ?';
            params.push(options.limit);
        }
        if (options.offset) {
            sql += ' OFFSET ?';
            params.push(options.offset);
        }

        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params);
        return rows.map((row: any) => this.rowToAsset(row));
    }

    /**
     * Update asset properties
     */
    public update(id: string, updates: Partial<Omit<Asset, 'id' | 'createdAt'>>): Asset | null {
        const existing = this.getById(id);
        if (!existing) return null;

        const updatedAsset = { ...existing, ...updates, updatedAt: Date.now() };

        const stmt = this.db.prepare(`
            UPDATE assets SET
                name = ?, description = ?, tags = ?, metadata = ?,
                folder = ?, is_favorite = ?, is_archived = ?, updated_at = ?
            WHERE id = ?
        `);

        stmt.run(
            updatedAsset.name,
            updatedAsset.description || null,
            JSON.stringify(updatedAsset.tags),
            JSON.stringify(updatedAsset.metadata),
            updatedAsset.folder,
            updatedAsset.isFavorite ? 1 : 0,
            updatedAsset.isArchived ? 1 : 0,
            updatedAsset.updatedAt,
            id
        );

        console.log(`[AssetCatalog] 📝 Updated: ${updatedAsset.name}`);
        return updatedAsset;
    }

    /**
     * Delete asset (and optionally the file)
     */
    public async delete(id: string, deleteFile: boolean = false): Promise<boolean> {
        const asset = this.getById(id);
        if (!asset) return false;

        if (deleteFile) {
            try {
                await fs.unlink(asset.filePath);
                if (asset.thumbnailPath) {
                    await fs.unlink(asset.thumbnailPath);
                }
            } catch (e) {
                console.warn('[AssetCatalog] Could not delete file:', e);
            }
        }

        const stmt = this.db.prepare('DELETE FROM assets WHERE id = ?');
        stmt.run(id);

        console.log(`[AssetCatalog] 🗑️ Deleted: ${asset.name}`);
        return true;
    }

    /**
     * Add tags to an asset
     */
    public addTags(id: string, tags: string[]): Asset | null {
        const asset = this.getById(id);
        if (!asset) return null;

        const newTags = [...new Set([...asset.tags, ...tags])];
        return this.update(id, { tags: newTags });
    }

    /**
     * Remove tags from an asset
     */
    public removeTags(id: string, tags: string[]): Asset | null {
        const asset = this.getById(id);
        if (!asset) return null;

        const newTags = asset.tags.filter(t => !tags.includes(t));
        return this.update(id, { tags: newTags });
    }

    /**
     * Move asset to folder
     */
    public moveToFolder(id: string, folder: string): Asset | null {
        return this.update(id, { folder });
    }

    /**
     * Toggle favorite status
     */
    public toggleFavorite(id: string): Asset | null {
        const asset = this.getById(id);
        if (!asset) return null;
        return this.update(id, { isFavorite: !asset.isFavorite });
    }

    /**
     * Archive asset
     */
    public archive(id: string): Asset | null {
        return this.update(id, { isArchived: true });
    }

    /**
     * Get all unique folders
     */
    public getFolders(): string[] {
        const stmt = this.db.prepare('SELECT DISTINCT folder FROM assets ORDER BY folder');
        const rows = stmt.all();
        return rows.map((row: any) => row.folder);
    }

    /**
     * Get all unique tags
     */
    public getAllTags(): string[] {
        const assets = this.search({ limit: 1000 });
        const tagSet = new Set<string>();
        assets.forEach(a => a.tags.forEach(t => tagSet.add(t)));
        return Array.from(tagSet).sort();
    }

    /**
     * Get statistics
     */
    public getStats(): {
        total: number;
        byType: Record<AssetType, number>;
        totalSizeBytes: number;
        favorites: number;
        archived: number;
    } {
        const countStmt = this.db.prepare('SELECT type, COUNT(*) as count FROM assets GROUP BY type');
        const rows = countStmt.all();

        const byType: Record<AssetType, number> = { image: 0, video: 0, audio: 0, document: 0 };
        rows.forEach((row: any) => {
            byType[row.type as AssetType] = row.count;
        });

        const sizeStmt = this.db.prepare('SELECT SUM(size_bytes) as total FROM assets');
        const sizeRow = sizeStmt.get() as any;

        const favStmt = this.db.prepare('SELECT COUNT(*) as count FROM assets WHERE is_favorite = 1');
        const favRow = favStmt.get() as any;

        const archStmt = this.db.prepare('SELECT COUNT(*) as count FROM assets WHERE is_archived = 1');
        const archRow = archStmt.get() as any;

        return {
            total: Object.values(byType).reduce((a, b) => a + b, 0),
            byType,
            totalSizeBytes: sizeRow?.total || 0,
            favorites: favRow?.count || 0,
            archived: archRow?.count || 0
        };
    }

    /**
     * Generate thumbnail for an asset
     */
    private async generateThumbnail(filePath: string, type: AssetType): Promise<string | undefined> {
        const thumbnailDir = path.join(process.cwd(), 'uploads', 'thumbnails');

        try {
            // Ensure thumbnail directory exists
            await fs.mkdir(thumbnailDir, { recursive: true });

            const baseName = path.basename(filePath, path.extname(filePath));
            const thumbnailPath = path.join(thumbnailDir, `${baseName}_thumb.webp`);

            if (type === 'image') {
                // Use sharp for image thumbnails
                try {
                    const sharp = (await import('sharp')).default;
                    await sharp(filePath)
                        .resize(200, 200, { fit: 'cover' })
                        .webp({ quality: 80 })
                        .toFile(thumbnailPath);
                    return thumbnailPath;
                } catch (sharpError: any) {
                    console.warn('[AssetCatalog] Sharp not available for thumbnail generation');
                    return undefined;
                }
            } else if (type === 'video') {
                // Use ffmpeg for video thumbnails (first frame)
                try {
                    const { exec } = await import('child_process');
                    const { promisify } = await import('util');
                    const execAsync = promisify(exec);

                    // Extract first frame at 1 second
                    await execAsync(
                        `ffmpeg -i "${filePath}" -ss 00:00:01 -vframes 1 -vf "scale=200:200:force_original_aspect_ratio=decrease" "${thumbnailPath}" -y`,
                        { timeout: 30000 }
                    );
                    return thumbnailPath;
                } catch (ffmpegError: any) {
                    console.warn('[AssetCatalog] FFmpeg not available for video thumbnail');
                    return undefined;
                }
            }

            return undefined;
        } catch (e: any) {
            console.warn('[AssetCatalog] Thumbnail generation failed:', e.message);
            return undefined;
        }
    }

    /**
     * Get MIME type from file extension
     */
    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain',
            '.md': 'text/markdown'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    /**
     * Convert DB row to Asset object
     */
    private rowToAsset(row: any): Asset {
        return {
            id: row.id,
            type: row.type as AssetType,
            name: row.name,
            description: row.description,
            filePath: row.file_path,
            thumbnailPath: row.thumbnail_path,
            sizeBytes: row.size_bytes,
            mimeType: row.mime_type,
            prompt: row.prompt,
            provider: row.provider,
            tags: JSON.parse(row.tags || '[]'),
            metadata: JSON.parse(row.metadata || '{}'),
            folder: row.folder,
            isFavorite: row.is_favorite === 1,
            isArchived: row.is_archived === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessedAt: row.accessed_at
        };
    }

    /**
     * Check if a file path is already registered
     */
    public isRegistered(filePath: string): boolean {
        const stmt = this.db.prepare('SELECT id FROM assets WHERE file_path = ?');
        const row = stmt.get(filePath);
        return !!row;
    }

    /**
     * Sync existing files from uploads folder
     * Scans for unregistered files and adds them to the catalog
     */
    public async syncExistingFiles(uploadsDir?: string): Promise<{ added: number; skipped: number }> {
        const baseDir = uploadsDir || path.resolve(process.cwd(), 'uploads');
        let added = 0;
        let skipped = 0;

        console.log(`[AssetCatalog] 🔄 Syncing existing files from: ${baseDir}`);

        const typeMap: Record<string, AssetType> = {
            'image': 'image',
            'images': 'image',
            'video': 'video',
            'videos': 'video',
            'audio': 'audio',
            'document': 'document',
            'documents': 'document'
        };

        try {
            // Scan subdirectories
            const subdirs = await fs.readdir(baseDir, { withFileTypes: true });

            for (const subdir of subdirs) {
                if (!subdir.isDirectory()) continue;

                const assetType = typeMap[subdir.name.toLowerCase()];
                if (!assetType) continue;

                const typePath = path.join(baseDir, subdir.name);
                const files = await this.scanDirectory(typePath);

                for (const filePath of files) {
                    // Skip if already registered
                    if (this.isRegistered(filePath)) {
                        skipped++;
                        continue;
                    }

                    // Register new asset
                    const fileName = path.basename(filePath, path.extname(filePath));
                    try {
                        await this.register({
                            type: assetType,
                            name: fileName,
                            filePath: filePath,
                            tags: ['synced', assetType],
                            folder: `/${subdir.name}`
                        });
                        added++;
                    } catch (e: any) {
                        console.warn(`[AssetCatalog] Failed to register ${filePath}:`, e.message);
                    }
                }
            }

            console.log(`[AssetCatalog] ✅ Sync complete: ${added} added, ${skipped} skipped`);
            return { added, skipped };

        } catch (e: any) {
            console.error('[AssetCatalog] Sync error:', e.message);
            return { added, skipped };
        }
    }

    /**
     * Recursively scan directory for media files
     */
    private async scanDirectory(dir: string): Promise<string[]> {
        const files: string[] = [];
        const validExtensions = [
            '.png', '.jpg', '.jpeg', '.gif', '.webp',
            '.mp4', '.webm', '.mov', '.avi',
            '.mp3', '.wav', '.ogg',
            '.pdf', '.txt', '.md'
        ];

        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Recurse into subdirectories
                    const subFiles = await this.scanDirectory(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (validExtensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        } catch (e) {
            // Directory may not exist, that's OK
        }

        return files;
    }

    /**
     * Clean up orphaned entries (files that no longer exist)
     */
    public async cleanupOrphans(): Promise<number> {
        const assets = this.search({ limit: 10000 });
        let removed = 0;

        for (const asset of assets) {
            try {
                await fs.access(asset.filePath);
            } catch {
                // File doesn't exist, remove from catalog
                this.db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
                removed++;
                console.log(`[AssetCatalog] 🧹 Orphan removed: ${asset.name}`);
            }
        }

        if (removed > 0) {
            console.log(`[AssetCatalog] ✅ Cleanup: ${removed} orphans removed`);
        }

        return removed;
    }
}

export const assetCatalog = new AssetCatalogService();
