
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { geminiService } from '../geminiService';
import { lancedbService } from '../lancedbService';

const UNIVERSAL_PROMPTS_DIR = path.resolve(process.cwd(), 'universalprompts');

export interface KnowledgeItem {
    id: string;
    path: string;
    content: string;
    vector: number[];
    tags: string[];
    source: string;
    timestamp: number;
}

export class UniversalIndexer {
    private isRunning = false;
    private processedCount = 0;

    /**
     * Recursively walks the directory and indexes files.
     */
    public async indexAll(dir: string = UNIVERSAL_PROMPTS_DIR) {
        if (this.isRunning) {
            console.warn("[INDEXER] Already running.");
            return;
        }

        // [MOD] Ensure DB is ready before starting
        // This is crucial if we removed auto-init in Service constructor
        const { lancedbService } = await import('../lancedbService'); // Dynamic import to maybe avoid side-effects?
        // Actually, importing at top level is fine if constructor doesn't start heavy stuff.

        // We need to access the private init or just call a public method that triggers it?
        // storeKnowledge calls init internally, so it should be fine.

        this.isRunning = true;
        this.processedCount = 0;
        console.log(`[INDEXER] Starting ingestion from: ${dir}`);

        try {
            await this.walkAndProcess(dir);
            console.log(`[INDEXER] Ingestion Complete. Processed ${this.processedCount} files.`);
            return; // Explicit return
        } catch (e) {
            console.error("[INDEXER] Fatal Error", e);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Recursive directory walker
     */
    private async walkAndProcess(currentDir: string) {
        const files = fs.readdirSync(currentDir);

        for (const file of files) {
            const fullPath = path.join(currentDir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                if (file.startsWith('.')) continue; // Skip hidden dirs
                await this.walkAndProcess(fullPath);
            } else {
                await this.processSingleFile(fullPath);
            }
        }
    }

    /**
     * Process a single file: Read, Embed, Store.
     */
    public async processSingleFile(filePath: string) {
        const ext = path.extname(filePath).toLowerCase();
        if (!['.txt', '.md', '.json', '.yaml'].includes(ext)) {
            return; // Skip binary or irrelevant files
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content || content.length < 50) return; // Skip empty/tiny files

            // Generate ID deterministically from path (allows re-indexing without dupes)
            const id = crypto.createHash('md5').update(filePath).digest('hex');

            // Generate Embedding
            // [OPTIMIZATION] Check if already exists? (TODO for Phase 3)
            // For now, we overwrite to ensure freshness.

            const embedding = await geminiService.generateEmbedding(content);
            if (!embedding) {
                console.warn(`[INDEXER] Failed to generate embedding for: ${path.basename(filePath)}`);
                return;
            }

            // Extract Tags from Path (e.g., "Google/Gemini/..." -> ["Google", "Gemini"])
            const relativePath = path.relative(UNIVERSAL_PROMPTS_DIR, filePath);
            const pathParts = relativePath.split(path.sep);
            pathParts.pop(); // Remove filename
            const tags = pathParts;

            const item: KnowledgeItem = {
                id: id,
                path: relativePath, // Store relative path for portability
                content: content,
                vector: embedding,
                tags: tags,
                source: 'universal_prompts',
                timestamp: Date.now()
            };

            await lancedbService.storeKnowledge(item);
            this.processedCount++;

            if (this.processedCount % 10 === 0) {
                console.log(`[INDEXER] Progress: ${this.processedCount} files indexed.`);
            }

        } catch (e) {
            console.error(`[INDEXER] Error processing file ${filePath}:`, e);
        }
    }
}

export const universalIndexer = new UniversalIndexer();
