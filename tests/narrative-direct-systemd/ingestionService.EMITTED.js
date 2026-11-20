import { MemoryTier } from "../types.js";
import { v4 as uuidv4 } from 'uuid';
export class IngestionService {
    constructor() {
        this.CHUNK_SIZE = 20000; // ~5k tokens
        this.OVERLAP = 500;
    }
    async ingest(content, tags = []) {
        if (content.length <= this.CHUNK_SIZE) {
            return false; // Not large enough to need ingestion
        }
        console.log(`[INGESTION] 📚 Large content detected (${content.length} chars). Initiating chunking...`);
        const parentId = uuidv4();
        const chunks = this.chunkText(content);
        // Dynamic import to avoid circular dependency
        const { continuum } = await import("./continuumMemory.js");
        // 1. Store Chunks
        for (let i = 0; i < chunks.length; i++) {
            const chunkContent = chunks[i];
            const chunkTags = [...tags, `chunk:${parentId}`, `index:${i}`, 'type:CHUNK'];
            // Store in LONG tier immediately (or MEDIUM)
            await continuum.store(chunkContent, MemoryTier.MEDIUM, chunkTags, true);
        }
        // 2. Recursive Summarization (The "Librarian" Swarm)
        console.log(`[INGESTION] 🧠 Swarm Reading: Dispatching ${chunks.length} chunks to TEAM_CONTEXT...`);
        const summaries = [];
        const { generateAgentResponse } = await import("./geminiService.js");
        const { IntrospectionLayer, WorkflowStage, CommunicationLevel } = await import("../types.js");
        // Parallel Processing (Map Phase)
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            try {
                const response = await generateAgentResponse("Librarian_Unit", "Context Librarian", "DATA", `Summarize this text chunk (Part ${i + 1}/${chunks.length}). Capture key facts, names, and events. Keep it dense.`, chunk, IntrospectionLayer.SHALLOW, // Fast processing
                WorkflowStage.INTENT, undefined, {}, [], CommunicationLevel.TECHNICAL);
                summaries.push(response.output);
            }
            catch (e) {
                console.warn(`[INGESTION] Failed to summarize chunk ${i}`, e);
                summaries.push("[Missing Summary]");
            }
        }
        // 3. Master Synthesis (Reduce Phase)
        const masterPrompt = `
        Synthesize these ${summaries.length} chunk summaries into a coherent Master Summary of the entire document.
        Preserve the narrative arc and critical details.
        
        SUMMARIES:
        ${summaries.join('\n\n')}
        `;
        let masterSummary = "Processing failed.";
        try {
            const synthesis = await generateAgentResponse("Chief_Librarian", "Knowledge Keeper", "CORE", "Create Master Summary.", masterPrompt, IntrospectionLayer.DEEP, WorkflowStage.OPTIMIZATION, undefined, {}, [], CommunicationLevel.EXECUTIVE);
            masterSummary = synthesis.output;
        }
        catch (e) {
            console.error("[INGESTION] Master Synthesis failed", e);
            masterSummary = summaries.join('\n\n'); // Fallback to raw concatenation
        }
        // 4. Create Parent Node (Master Record)
        const parentTags = [...tags, 'type:MASTER', 'has_chunks', 'summarized'];
        // Store Parent in SHORT/MEDIUM (so it's visible/dreamable)
        await continuum.store(masterSummary, MemoryTier.SHORT, parentTags, true);
        console.log(`[INGESTION] ✅ Ingested & Summarized ${chunks.length} chunks. Master ID: ${parentId}`);
        return true;
    }
    chunkText(text) {
        const chunks = [];
        let index = 0;
        while (index < text.length) {
            const end = Math.min(index + this.CHUNK_SIZE, text.length);
            chunks.push(text.substring(index, end));
            index += (this.CHUNK_SIZE - this.OVERLAP);
        }
        return chunks;
    }
}
export const ingestion = new IngestionService();
