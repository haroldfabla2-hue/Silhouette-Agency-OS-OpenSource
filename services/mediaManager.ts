
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export type MediaType = 'video' | 'image' | 'audio' | 'document';

export class MediaManager {
    private baseUploadsDir: string;

    constructor() {
        this.baseUploadsDir = path.join(process.cwd(), 'uploads');
    }

    /**
     * Organizes a file into the semantic folder structure: uploads/{type}/{date}/{filename}
     * @param sourcePath Absolute path of the source file
     * @param type MediaType to classify the asset
     * @param jobId Optional Job ID to prefix the filename
     * @returns The relative path to the organized file (for DB storage)
     */
    public async organizeAsset(sourcePath: string, type: MediaType, jobId?: string): Promise<string> {
        try {
            // 1. Generate Target Directory based on Date
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const targetDir = path.join(this.baseUploadsDir, type, today);

            await fs.mkdir(targetDir, { recursive: true });

            // 2. Generate Target Filename
            const ext = path.extname(sourcePath);
            const originalName = path.basename(sourcePath, ext);

            // Sanitize original name or use generic if weird
            const sanitizedName = originalName.replace(/[^a-zA-Z0-9_\-]/g, '_');

            // Create robust unique name: {jobId}_{sanitizedName}.{ext}
            let finalName = sanitizedName;
            if (jobId) {
                finalName = `${jobId}_${sanitizedName}`;
            } else {
                // Determine uniqueness via hash if no job id
                const suffix = crypto.randomBytes(4).toString('hex');
                finalName = `${sanitizedName}_${suffix}`;
            }

            const targetPath = path.join(targetDir, `${finalName}${ext}`);

            // 3. Move File (Copy + Unlink to handle cross-device if needed, though usually fs.rename is fine on same drive)
            // Using rename is atomic on same filesystem.
            await fs.rename(sourcePath, targetPath);

            console.log(`[MediaManager] 🗄️ Organized: ${path.basename(sourcePath)} -> ${type}/${today}/${path.basename(targetPath)}`);

            // Return relative path for database consistency
            return path.relative(process.cwd(), targetPath).replace(/\\/g, '/');

        } catch (error: any) {
            console.error(`[MediaManager] ❌ Failed to organize asset ${sourcePath}:`, error);
            throw error;
        }
    }

    /**
     * Lists available assets of a specific type (e.g. 'image')
     * Useful for agents to "see" what is available for processing.
     */
    public async listAvailableAssets(type: MediaType, filter?: string): Promise<string[]> {
        const typeDir = path.join(this.baseUploadsDir, type);
        try {
            await fs.access(typeDir);
        } catch {
            return [];
        }

        const assets: string[] = [];

        // Helper to scan recursively (depth 1 level: date folders)
        const entries = await fs.readdir(typeDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Check inside date folder
                const datePath = path.join(typeDir, entry.name);
                const files = await fs.readdir(datePath);
                for (const file of files) {
                    if (filter && !file.toLowerCase().includes(filter.toLowerCase())) continue;

                    // Return relative path: uploads/image/2024-12-18/file.png
                    // Normalized to forward slashes for agent consistency
                    const fullPath = path.join(datePath, file);
                    const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
                    assets.push(relPath);
                }
            }
        }

        // Basic sort by recent (folder name YYYY-MM-DD helps)
        return assets.sort().reverse();
    }
}

export const mediaManager = new MediaManager();
