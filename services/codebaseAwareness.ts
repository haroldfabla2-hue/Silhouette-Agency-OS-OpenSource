import type { EmbedText } from './memoryVectorContract';

import { SystemProtocol, FileNode, CodeChunk, IntrospectionCapability } from "../types";
import { systemBus } from "./systemBus";
import { vfs } from "./virtualFileSystem";
import { unifiedVectorMemory } from "./unifiedVectorMemory";
import { embedMemoryText } from "./memoryVectorContract";

import * as crypto from 'crypto';

// --- CODEBASE AWARENESS SERVICE ---
// Gives Silhouette the ability to "know" its own code via RAG.
// Listens for VFS changes, chunks code, and updates Vector Memory.

export class CodebaseAwarenessService {
    private static readonly fileWrites = new Map<string, Promise<void>>();
    private isIndexing: boolean = false;
    private readonly COLLECTION_PREFIX = "code_";

    constructor(private readonly dependencies: { memory: Pick<typeof unifiedVectorMemory, 'storeMemory' | 'searchMemory' | 'commitCodeVersion'>; embed: EmbedText } = {
        memory: unifiedVectorMemory, embed: embedMemoryText
    }, subscribe = true) {
        if (subscribe) this.initialize();
    }

    private initialize() {
        // Subscribe to File System Updates
        systemBus.subscribe(SystemProtocol.FILESYSTEM_UPDATE, async (event) => {
            if (event.payload.action === 'DELETE' && event.payload.fileId) {
                await this.deleteFile(event.payload.fileId);
                return;
            }
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
        try {
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

            console.log(`[CODEBASE AWARENESS] Full index complete.`);
        } finally { this.isIndexing = false; }
    }

    /**
     * Indexes a single file.
     * 1. Checks hash to avoid redundant work.
     * 2. Chunks content.
     * 3. Embeds and stores in Vector DB.
     */
    public deleteFile(fileId: string): Promise<void> {
        const previous = CodebaseAwarenessService.fileWrites.get(fileId) || Promise.resolve();
        const operation = previous.catch(() => undefined).then(() => this.dependencies.memory.commitCodeVersion(fileId, 'DELETED'));
        CodebaseAwarenessService.fileWrites.set(fileId, operation);
        void operation.finally(() => {
            if (CodebaseAwarenessService.fileWrites.get(fileId) === operation) CodebaseAwarenessService.fileWrites.delete(fileId);
        }).catch(() => undefined);
        return operation;
    }

    public indexFile(node: FileNode): Promise<void> {
        // Snapshot the arrival and serialize same-file writes across service
        // instances in this process. A slow old embedding cannot activate after
        // a newer accepted file event. Cross-process writers need stronger CAS.
        const snapshot = { ...node };
        const previous = CodebaseAwarenessService.fileWrites.get(node.id) || Promise.resolve();
        const operation = previous.catch(() => undefined).then(() => this.indexFileOnce(snapshot));
        CodebaseAwarenessService.fileWrites.set(node.id, operation);
        void operation.finally(() => {
            if (CodebaseAwarenessService.fileWrites.get(node.id) === operation) CodebaseAwarenessService.fileWrites.delete(node.id);
        }).catch(() => undefined);
        return operation;
    }

    private async indexFileOnce(node: FileNode): Promise<void> {
        if (typeof node.content !== 'string') throw new Error('Code file content unavailable; version not changed');

        // Filter for code files only
        if (!node.name.match(/\.(ts|tsx|js|jsx|py|css|html)$/)) return;

        // 1. Change Detection
        const hash = crypto.createHash('md5').update(node.content).digest('hex');


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
                id: `${node.id}_${hash}_chunk_${i}`,
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
            const embedded = await this.dependencies.embed(chunk.content);
            if (!embedded) throw new Error('Code RAG embedding unavailable; file remains pending');
            if (embedded) {
                await this.dependencies.memory.storeMemory(chunk.id, embedded.vector, {
                    type: 'CODE_CHUNK',
                    ...chunk, fileId: node.id
                }, embedded.identity);
            }
        }
        await this.dependencies.memory.commitCodeVersion(node.id, hash);

    }

    /**
     * Queries the codebase for relevant snippets.
     */
    public async query(userQuery: string, limit: number = 3): Promise<string> {
        const embedded = await this.dependencies.embed(userQuery);
        if (!embedded) throw new Error('Code RAG query embedding unavailable');

        const results = await this.dependencies.memory.searchMemory(embedded.vector, limit, { type: 'CODE_CHUNK' }, embedded.identity);

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
