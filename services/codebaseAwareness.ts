import { preserveOriginal } from './lifecycle/preserveOriginal';
import { codebaseOwner } from './lifecycle/preparationBindings';
import type { Scope, Operation } from './lifecycle/host';

import { SystemProtocol, FileNode, CodeChunk, IntrospectionCapability } from "../types";
import { systemBus } from "./systemBus";
import { vfs } from "./virtualFileSystem";
import { vectorMemory } from "./vectorMemoryService";

import * as crypto from 'crypto';

// --- CODEBASE AWARENESS SERVICE ---
// Gives Silhouette the ability to "know" its own code via RAG.
// Listens for VFS changes, chunks code, and updates Vector Memory.

export class CodebaseAwarenessService {
    private isIndexing: boolean = false;
    private fileHashes: Map<string, string> = new Map(); // Cache for change detection
    private readonly COLLECTION_PREFIX = "code_";

    constructor(private readonly embed: (text: string) => Promise<number[] | null> = async text =>
        (await import('./geminiService')).generateEmbedding(text), subscribe = true,
        private readonly ownership: Scope, construction: Operation) {
        ownership.validateConstruction(construction);
        if (subscribe) this.initialize();
    }

    private initialize() {
        // Subscribe to File System Updates
        const unsubscribe = systemBus.subscribe(SystemProtocol.FILESYSTEM_UPDATE, async (event) => {
            if (event.payload.action === 'UPDATE' || event.payload.action === 'CREATE') {
                // We need the file ID or path. The event payload might need adjustment if it only sends ID.
                // Assuming payload has { projectId, fileId, action }
                if (event.payload.fileId) {
                    const node = vfs.getNode(event.payload.fileId);
                    if (node && node.type === 'FILE') {
                        try { await this.ownership.invoke('original-file-index-delivery', () => this.indexFile(node)); }
                        catch (error) { this.ownership.failure('index:ORIGINAL_RETRYABLE_FAILURE', error); console.error("[CODEBASE AWARENESS] Indexing failed; file remains retryable:", error); }
                    }
                }
            }
        });

        this.ownership.onSeal(unsubscribe);
        console.log("[CODEBASE AWARENESS] Online. Listening for code changes.");
    }

    /**
     * Scans the entire project and indexes it. 
     * Expensive! Use sparingly (e.g., on first boot or explicit request).
     */
    public indexProject(projectId: string) {
        return this.ownership.invoke('original-indexProject', operation => this.indexProjectOriginal(operation, projectId));
    }
    private async indexProjectOriginal(operation: Operation, projectId: string) {
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
                await this.indexFileOriginal(operation, node);
            }
        };

        try {
            const project = vfs.getProjects().find(p => p.id === projectId);
            if (project) await processNode(project.rootFolderId);
            console.log(`[CODEBASE AWARENESS] Full index complete.`);
        } finally { this.isIndexing = false; }
    }

    /**
     * Indexes a single file.
     * 1. Checks hash to avoid redundant work.
     * 2. Chunks content.
     * 3. Embeds and stores in Vector DB.
     */
    public indexFile(node: FileNode) {
        return this.ownership.invoke('original-indexFile', operation => this.indexFileOriginal(operation, node));
    }
    private async indexFileOriginal(operation: Operation, node: FileNode) {
        if (!node.content) return;

        // Filter for code files only
        if (!node.name.match(/\.(ts|tsx|js|jsx|py|css|html)$/)) return;

        // 1. Change Detection
        const hash = crypto.createHash('md5').update(node.content).digest('hex');
        if (this.fileHashes.get(node.id) === hash) {
            // No change
            return;
        }

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
            const vector = await this.embed(chunk.content);
            if (!vector) throw new Error('Code RAG embedding unavailable; file remains retryable');
            if (vector) {
                await vectorMemory.storeMemory(chunk.id, vector, {
                    type: 'CODE_CHUNK',
                    ...chunk
                });
            }
        }
        this.fileHashes.set(node.id, hash);
    }

    /**
     * Queries the codebase for relevant snippets.
     */
    public query(userQuery: string, limit: number = 3): Promise<string> {
        return this.ownership.invoke('original-query', operation => this.queryOriginal(operation, userQuery, limit));
    }
    private async queryOriginal(operation: Operation, userQuery: string, limit: number = 3): Promise<string> {
        const vector = await this.embed(userQuery);
        if (!vector) throw new Error('Code RAG query embedding unavailable');

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

export function createOwnedCodebaseAwareness(
    embed: ((text: string) => Promise<number[] | null>) | undefined,
    subscribe: boolean | undefined, ownership: Scope): CodebaseAwarenessService {
    const operation = ownership.beginConstruction();
    try {
        const instance = new CodebaseAwarenessService(embed, subscribe, ownership, operation);
        ownership.constructed(operation, instance); return instance;
    } catch (original) {
        preserveOriginal(ownership, 'construction-failure', () => ownership.constructionFailed(operation, original));
        throw original;
    }
}
export const codebaseAwareness = createOwnedCodebaseAwareness(undefined, undefined, codebaseOwner());
