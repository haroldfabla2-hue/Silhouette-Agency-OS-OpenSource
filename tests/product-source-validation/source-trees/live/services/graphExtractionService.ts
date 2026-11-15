import { generateAgentResponse } from './geminiService';
import { CommunicationLevel } from '../types';
import crypto from 'crypto';

// --- GRAPH EXTRACTION SERVICE ---
// "The Senses of the Living Graph"
// Uses LLM to parse unstructured text into Nodes and Edges.

interface GraphData {
    nodes: { id: string; label: string; properties: any }[];
    edges: { from: string; to: string; type: string; properties: any }[];
}

export class GraphExtractionService {

    public async extractEntities(userMessage: string, aiResponse: string): Promise<GraphData> {
        // [OPTIMIZATION] Fire-and-forget to prevent blocking the main chat thread.
        // We return empty immediately, and handle extraction + persistence in the background.
        this.runBackgroundExtraction(userMessage, aiResponse).catch(e => console.error("[GRAPH_BG] Error:", e));
        return { nodes: [], edges: [] };
    }

    /**
     * IMMEDIATE extraction of user name - no LLM needed
     * This ensures we NEVER forget when user says "Me llamo X" or "My name is X"
     */
    private async extractUserNameDirectly(userMessage: string): Promise<void> {
        try {
            const messageLower = userMessage.toLowerCase();

            // Patterns for name extraction
            const patterns = [
                /(?:me llamo|mi nombre es|soy)\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)/i,
                /(?:my name is|i'm|i am)\s+([A-Za-z]+)/i,
                /(?:llámame|call me)\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)/i
            ];

            for (const pattern of patterns) {
                const match = userMessage.match(pattern);
                if (match && match[1]) {
                    const userName = match[1].trim();

                    // Skip if it's a common word, not a name
                    const skipWords = ['el', 'la', 'un', 'una', 'the', 'a', 'an'];
                    if (skipWords.includes(userName.toLowerCase())) continue;

                    console.log(`[GRAPH_EXTRACT] 👤 DETECTED USER NAME: ${userName}`);

                    const { graph } = await import('./graphService');

                    // Create/Update User node with the name
                    await graph.createNode('User', {
                        id: 'user_primary',
                        name: userName,
                        type: 'PRIMARY_USER',
                        extractedAt: Date.now()
                    }, 'id');

                    console.log(`[GRAPH_EXTRACT] ✅ User node created/updated: ${userName}`);

                    // Also store in ContinuumMemory for redundancy
                    const { continuum } = await import('./continuumMemory');
                    const { MemoryTier } = await import('../types');
                    await continuum.store(
                        `El nombre del usuario es ${userName}. User name: ${userName}.`,
                        MemoryTier.SHORT, // Store in SHORT tier for persistence
                        ['user', 'name', 'profile', userName.toLowerCase()],
                        false // Don't skip ingestion
                    );

                    console.log(`[GRAPH_EXTRACT] ✅ User name also stored in ContinuumMemory`);
                    break; // Found name, no need to continue
                }
            }
        } catch (error) {
            console.error("[GRAPH_EXTRACT] ⚠️ Failed to extract user name:", error);
        }
    }

    private async runBackgroundExtraction(userMessage: string, aiResponse: string) {
        console.log("[GRAPH_EXTRACT] 🕵️ Background Extraction Started...");

        // IMMEDIATE: Extract user name directly without LLM
        // This ensures we never forget when user says "Me llamo X"
        await this.extractUserNameDirectly(userMessage);


        const prompt = `
        TASK: Extract a Knowledge Graph from the following interaction.
        
        CONTEXT:
        User: "${userMessage}"
        AI: "${aiResponse}"

        INSTRUCTIONS:
        1. Identify key ENTITIES (Nodes). Labels: User, Concept, Tool, Emotion, Goal, Constraint, Project.
        2. Identify RELATIONSHIPS (Edges). Types: HAS_GOAL, FEELS, USES, BLOCKED_BY, RELATED_TO.
        3. Output strictly valid JSON.

        EXAMPLE OUTPUT:
        {
            "nodes": [
                {"id": "user", "label": "User", "properties": {"name": "User"}},
                {"id": "latency", "label": "Concept", "properties": {"name": "Latency"}},
                {"id": "frustration", "label": "Emotion", "properties": {"name": "Frustration"}}
            ],
            "edges": [
                {"from": "user", "to": "frustration", "type": "FEELS", "properties": {"intensity": 0.8}},
                {"from": "frustration", "to": "latency", "type": "CAUSED_BY", "properties": {}}
            ]
        }
        `;

        try {
            const { generateAgentResponse } = await import('./geminiService');
            const { graph } = await import('./graphService');

            const response = await generateAgentResponse(
                "GraphExtractor",
                "System",
                "ANALYSIS",
                prompt,
                null,
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.TECHNICAL
            );

            let jsonStr = response.output.trim();
            // Regex to extract JSON object (find first { and last })
            const firstBrace = jsonStr.indexOf('{');
            const lastBrace = jsonStr.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            }

            let rawData: GraphData;
            try {
                rawData = JSON.parse(jsonStr);
            } catch (e) {
                console.error("[GRAPH_EXTRACT] ❌ JSON Parse Error. Raw Output:", response.output);
                return;
            }

            // Basic validation
            if (!rawData.nodes || !rawData.edges) return;

            // --- PERSISTENCE ---
            // 1. Process Nodes
            const idMap = new Map<string, string>();

            const generateId = (label: string, name: string) => {
                const seed = `${label}:${name.toLowerCase().trim()}`;
                return crypto.createHash('md5').update(seed).digest('hex');
            };

            for (const node of rawData.nodes) {
                const name = node.properties?.name || node.id || node.label;
                const newId = generateId(node.label, name);
                idMap.set(node.id, newId);

                // Persist Node
                await graph.createNode(node.label, { ...node.properties, id: newId, name });
            }

            // 2. Process Edges
            for (const edge of rawData.edges) {
                const newFrom = idMap.get(edge.from);
                const newTo = idMap.get(edge.to);

                if (newFrom && newTo) {
                    await graph.createRelationship(newFrom, newTo, edge.type, edge.properties);
                }
            }

            console.log(`[GRAPH_EXTRACT] ✅ Background Sync Complete: ${rawData.nodes.length} Nodes, ${rawData.edges.length} Edges.`);

        } catch (error) {
            console.error("[GRAPH_EXTRACT] ⚠️ Background Task Failed:", error);
        }
    }
}

export const graphExtractor = new GraphExtractionService();
