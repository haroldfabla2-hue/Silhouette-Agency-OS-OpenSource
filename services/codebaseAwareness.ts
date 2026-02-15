
import { SystemProtocol, FileNode, CodeChunk, IntrospectionCapability } from "../types";
import { systemBus } from "./systemBus";
import { vfs } from "./virtualFileSystem";
import { vectorMemory } from "./vectorMemoryService";
import { geminiService } from "./geminiService";
import * as crypto from 'crypto';

// --- CODEBASE AWARENESS SERVICE ---
// Gives Silhouette the ability to "know" its own code via RAG.
// Listens for VFS changes, chunks code, and updates Vector Memory.

class CodebaseAwarenessService {
    private isIndexing: boolean = false;
    private fileHashes: Map<string, string> = new Map(); // Cache for change detection
    private readonly COLLECTION_PREFIX = "code_";

    constructor() {
        this.initialize();
    }

    private initialize() {
        // Subscribe to File System Updates
        systemBus.subscribe(SystemProtocol.FILESYSTEM_UPDATE, async (event) => {
            if (event.payload.action === 'UPDATE' || event.payload.action === 'CREATE') {
                // We need the file ID or path. The event payload might need adjustment if it only sends ID.
                // Assuming payload has { projectId, fileId, action }
                if (event.payload.fileId) {
                    const node = vfs.getNode(event.payload.fileId);
                    if (node && node.type === 'FILE') {
                        await this.indexFile(node);
                    }
                }
            }
        });

        console.log("[CODEBASE AWARENESS] Online. Listening for code changes.");
    }

    /**
     * Scans the entire project and indexes it. 
     * Expensive! Use sparingly (e.g., on first boot or explicit request).
     */
    public async indexProject(projectId: string) {
        if (this.isIndexing) return;
        this.isIndexing = true;
        console.log(`[CODEBASE AWARENESS] Starting full index for project: ${projectId}`);

        const processNode = async (nodeId: string) => {
            const node = vfs.getNode(nodeId);
            if (!node) return;

            if (node.type === 'FOLDER' && node.children) {
                for (const childId of node.children) {
                    await processNode(childId);
                }
            } else if (node.type === 'FILE') {
                await this.indexFile(node);
            }
        };

        const project = vfs.getProjects().find(p => p.id === projectId);
        if (project) {
            await processNode(project.rootFolderId);
        }

        this.isIndexing = false;
        console.log(`[CODEBASE AWARENESS] Full index complete.`);
    }

    /**
     * Indexes a single file.
     * 1. Checks hash to avoid redundant work.
     * 2. Chunks content.
     * 3. Embeds and stores in Vector DB.
     */
    public async indexFile(node: FileNode) {
        if (!node.content) return;

        // Filter for code files only
        if (!node.name.match(/\.(ts|tsx|js|jsx|py|css|html)$/)) return;

        // 1. Change Detection
        const hash = crypto.createHash('md5').update(node.content).digest('hex');
        if (this.fileHashes.get(node.id) === hash) {
            // No change
            return;
        }
        this.fileHashes.set(node.id, hash);

        console.log(`[CODEBASE AWARENESS] Indexing file: ${node.name}`);

        // 2. Chunking Strategy (Simplified)
        // We split by logical blocks or fixed size with overlap.
        // For code, function/class boundaries are best, but regex is brittle.
        // Let's use a sliding window of lines for robustness.
        const lines = node.content.split('\n');
        const CHUNK_SIZE = 50; // Lines
        const OVERLAP = 10;

        const chunks: CodeChunk[] = [];

        for (let i = 0; i < lines.length; i += (CHUNK_SIZE - OVERLAP)) {
            const end = Math.min(i + CHUNK_SIZE, lines.length);
            const chunkLines = lines.slice(i, end);
            const content = chunkLines.join('\n');

            // Skip empty chunks
            if (content.trim().length < 20) continue;

            // Extract basic tags (naive parsing)
            const tags = [`file:${node.name}`];
            if (content.includes('class ')) tags.push('type:class');
            if (content.includes('function ') || content.includes('const ') && content.includes('=>')) tags.push('type:function');
            if (content.includes('interface ')) tags.push('type:interface');

            chunks.push({
                id: `${node.id}_chunk_${i}`,
                filePath: node.name, // We should ideally have full path, but name is ok for flat VFS
                startLine: i + 1,
                endLine: end,
                content: `// FILE: ${node.name} (Lines ${i + 1}-${end})\n${content}`,
                hash,
                tags,
                lastUpdated: Date.now()
            });
        }

        // 3. Embedding & Storage
        for (const chunk of chunks) {
            const vector = await geminiService.generateEmbedding(chunk.content);
            if (vector) {
                await vectorMemory.storeMemory(chunk.id, vector, {
                    type: 'CODE_CHUNK',
                    ...chunk
                });
            }
        }
    }

    /**
     * Queries the codebase for relevant snippets.
     */
    public async query(userQuery: string, limit: number = 3): Promise<string> {
        const vector = await geminiService.generateEmbedding(userQuery);
        if (!vector) return "";

        const results = await vectorMemory.searchMemory(vector, limit, { type: 'CODE_CHUNK' });

        if (results.length === 0) return "";

        const snippets = results.map((res: any) => res.payload.content).join('\n\n');

        return `
[CODEBASE AWARENESS - RAG RESULTS]:
The following code snippets were retrieved from the project to answer the query:
${snippets}
        `.trim();
    }
}

export const codebaseAwareness = new CodebaseAwarenessService();
