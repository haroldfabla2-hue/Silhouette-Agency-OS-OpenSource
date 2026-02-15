import fs from 'fs';
import path from 'path';

/**
 * DOCUMENTATION SYNC SERVICE
 * 
 * Automatically gathers .md documentation from the project and
 * provides it as context for the core agents.
 */
export class DocumentationSyncService {
    private static instance: DocumentationSyncService;
    private cachedDocs: string = '';
    private lastSync: number = 0;
    private readonly SYNC_INTERVAL = 1000 * 60 * 15; // 15 minutes

    private constructor() { }

    public static getInstance() {
        if (!DocumentationSyncService.instance) {
            DocumentationSyncService.instance = new DocumentationSyncService();
        }
        return DocumentationSyncService.instance;
    }

    /**
     * Get combined documentation context
     */
    public async getSystemContext(): Promise<string> {
        // Return cached if not expired
        if (this.cachedDocs && Date.now() - this.lastSync < this.SYNC_INTERVAL) {
            return this.cachedDocs;
        }

        try {
            const rootDir = process.cwd();
            const importantFiles = [
                'DIRECTIVA_OPERACIONAL.md',
                'ARQUITECTURA_ACTUAL_SILHOUETTE.md',
                'ARQUITECTURA_EVOLUTIVA.md',
                'MAPA_DE_MD.md',
                'PROJECT_MEMORY.md'
            ];

            let combinedContext = "\n--- SYSTEM KNOWLEDGE BASE ---\n";
            combinedContext += "The following documentation provides the core principles and architecture of the system you are operating in.\n\n";

            for (const fileName of importantFiles) {
                const filePath = path.join(rootDir, fileName);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    combinedContext += `### FILE: ${fileName}\n${content}\n\n`;
                }
            }

            // Also look for specific project plans in brain folder if needed, 
            // but let's stick to core docs for now to avoid context overflow.

            this.cachedDocs = combinedContext;
            this.lastSync = Date.now();
            return combinedContext;
        } catch (error) {
            console.error('[DocSync] Failed to sync documentation:', error);
            return "";
        }
    }

    /**
     * Clear cache to force refresh
     */
    public invalidateCache() {
        this.cachedDocs = '';
    }
}

export const documentationSync = DocumentationSyncService.getInstance();
