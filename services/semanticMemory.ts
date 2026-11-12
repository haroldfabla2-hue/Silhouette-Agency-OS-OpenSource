import type { EmbedText } from './memoryVectorContract';
import { unifiedVectorMemory } from './unifiedVectorMemory';
import { embedMemoryText } from './memoryVectorContract';
const generateAgentResponse: typeof import('./geminiService').generateAgentResponse = async (...args) =>
    (await import('./geminiService')).generateAgentResponse(...args);
import { CommunicationLevel } from '../types';
import { MemoryNode } from '../types';
import { v4 as uuidv4 } from 'uuid';

// --- TYPES ---
export interface SemanticInsight {
    id: string;
    type: 'FACT' | 'EVENT' | 'PREFERENCE' | 'RELATIONSHIP' | 'RAPTOR_NODE';
    content: string;
    entities: string[];
    confidence: number;
    sourceNodeId: string;
    timestamp: number;
    // RAPTOR Fields
    level?: number; // 0 = Leaf (Raw Text), 1 = Summary, 2 = Meta-Summary
    childrenIds?: string[];
    parentId?: string;
}

export class SemanticMemoryService {
    constructor(private readonly dependencies: { memory: Pick<typeof unifiedVectorMemory, 'storeMemory' | 'searchMemory'>; embed: EmbedText } = { memory: unifiedVectorMemory, embed: embedMemoryText }) {}


    // --- RAPTOR: RECURSIVE ABSTRACTIVE PROCESSING ---
    // The "Infinite Reader" Engine

    /**
     * Ingests a long document using the RAPTOR protocol.
     * 1. Chunks the text (Level 0).
     * 2. Summarizes chunks (Level 1).
     * 3. Recursively summarizes summaries until a Root Node is reached.
     */
    public async ingestDocument(title: string, fullText: string): Promise<void> {
        if (!fullText.trim()) throw new Error('Empty RAPTOR document rejected');
        console.log(`[RAPTOR] 🦖 Starting ingestion for: "${title}"`);

        // 1. Level 0: Chunking
        const chunks = this.chunkText(fullText, 500); // 500 chars overlap
        console.log(`[RAPTOR] Created ${chunks.length} leaf nodes (Level 0).`);

        let currentLevelNodes: SemanticInsight[] = [];

        // Store Level 0 Nodes
        for (const chunk of chunks) {
            const node: SemanticInsight = {
                id: uuidv4(),
                type: 'RAPTOR_NODE',
                content: `[${title}][L0]: ${chunk}`,
                entities: [],
                confidence: 1.0,
                sourceNodeId: 'document_ingestion',
                timestamp: Date.now(),
                level: 0,
                childrenIds: []
            };
            await this.storeInsight(node);
            currentLevelNodes.push(node);
        }

        // 2. Recursive Summarization (Level 1 -> Root)
        let currentLevel = 0;

        while (currentLevelNodes.length > 1) {
            console.log(`[RAPTOR] Building Level ${currentLevel + 1} from ${currentLevelNodes.length} nodes...`);

            const nextLevelNodes: SemanticInsight[] = [];
            const batchSize = 5; // Summarize 5 nodes at a time

            for (let i = 0; i < currentLevelNodes.length; i += batchSize) {
                const batch = currentLevelNodes.slice(i, i + batchSize);
                const summary = await this.summarizeBatch(batch, title, currentLevel + 1);

                // Extract entities from summary using LLM
                const entities = await this.extractEntitiesFromSummary(summary);
                
                const parentNode: SemanticInsight = {
                    id: uuidv4(),
                    type: 'RAPTOR_NODE',
                    content: summary,
                    entities,
                    confidence: 1.0,
                    sourceNodeId: 'raptor_synthesis',
                    timestamp: Date.now(),
                    level: currentLevel + 1,
                    childrenIds: batch.map(n => n.id)
                };

                await this.storeInsight(parentNode);
                nextLevelNodes.push(parentNode);
            }

            currentLevelNodes = nextLevelNodes;
            currentLevel++;
        }

        console.log(`[RAPTOR] ✅ Ingestion Complete. Root Node Reached at Level ${currentLevel}.`);
    }

    private chunkText(text: string, chunkSize: number = 1000): string[] {
        const chunks: string[] = [];
        let i = 0;
        const overlap = 100; // Overlap to maintain context
        while (i < text.length) {
            chunks.push(text.substring(i, i + chunkSize));
            i += (chunkSize - overlap);
        }
        return chunks;
    }

    private async summarizeBatch(nodes: SemanticInsight[], title: string, level: number): Promise<string> {
        const combinedContent = nodes.map(n => n.content).join('\n---\n');
        const prompt = `
        TASK: Summarize these text fragments from "${title}" into a higher-level abstraction.
        LEVEL: ${level} (Higher level = More abstract, less detail).
        
        FRAGMENTS:
        ${combinedContent}
        
        OUTPUT:
        A concise, dense summary (max 3 sentences) that captures the core themes and key facts.
        `;

        const response = await generateAgentResponse(
            "Raptor_Summarizer",
            "Editor",
            "CORE",
            prompt,
            null,
            undefined,
            undefined,
            { useWebSearch: false },
            {},
            [],
            CommunicationLevel.TECHNICAL,
            'gemini-1.5-flash' // FORCE FLASH FOR RAPTOR (Speed/Cost efficiency)
        );

        if (!response?.output?.trim()) throw new Error('RAPTOR summary unavailable; ingestion is incomplete');
        return `[${title}][L${level}]: ${response.output}`;
    }

    /**
     * Extract entities from a summary using LLM
     * Handles the TODO: Extract entities from summary
     */
    private async extractEntitiesFromSummary(summary: string): Promise<string[]> {
        try {
            const prompt = `
TASK: Extract named entities (people, places, organizations, concepts, technologies) from this text.
Return ONLY a JSON array of entity names, nothing else.

TEXT:
${summary.replace(/^\[.*?\]: /, '')}

OUTPUT FORMAT: ["entity1", "entity2", "entity3"]
`;

            const response = await generateAgentResponse(
                "Entity_Extractor",
                "Editor",
                "CORE",
                prompt,
                null,
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.TECHNICAL,
                'gemini-1.5-flash'
            );

            // Parse JSON array from response
            const match = response.output.match(/\[[\s\S]*\]/);
            if (match) {
                const entities = JSON.parse(match[0]);
                return entities.filter((e: string) => typeof e === 'string' && e.length > 0);
            }
            return [];
        } catch (error) {
            console.warn('[SEMANTIC] Failed to extract entities:', error);
            return [];
        }
    }

    // --- LEGACY DIGESTION (Kept for compatibility) ---

    public async digest(node: MemoryNode): Promise<SemanticInsight[]> {
        console.log(`[SEMANTIC] Digesting node ${node.id} for Eternal Memory...`);
        const insights = await this.extractInsights(node.content);
        for (const insight of insights) {
            await this.storeInsight(insight);
        }
        return insights;
    }

    public async recall(query: string, limit: number = 5): Promise<SemanticInsight[]> {
        const embedded = await this.dependencies.embed(query);
        if (!embedded) throw new Error('Semantic recall embedding unavailable');

        const results = await this.dependencies.memory.searchMemory(embedded.vector, limit, undefined, embedded.identity);
        return results.map((r: any) => ({
            id: r.id,
            type: r.payload.type,
            content: r.payload.content,
            entities: r.payload.entities,
            confidence: r.score,
            sourceNodeId: r.payload.source,
            timestamp: r.payload.timestamp,
            level: r.payload.level,
            childrenIds: r.payload.childrenIds,
            parentId: r.payload.parentId
        }));
    }

    private async extractInsights(text: string): Promise<SemanticInsight[]> {
        throw new Error('Semantic legacy digestion is not implemented; no extracted insights committed');
    }

    private async storeInsight(insight: SemanticInsight) {
        const embedded = await this.dependencies.embed(insight.content);
        if (!embedded) throw new Error('Semantic memory embedding unavailable; ingestion not saved');

        await this.dependencies.memory.storeMemory(insight.id, embedded.vector, {
            ...insight,
            type: insight.type,
            content: insight.content,
            entities: insight.entities,
            source: insight.sourceNodeId,
            timestamp: insight.timestamp,
            level: insight.level,
            childrenIds: insight.childrenIds,
            parentId: insight.parentId
        }, embedded.identity);
    }
}

export const semanticMemory = new SemanticMemoryService();
