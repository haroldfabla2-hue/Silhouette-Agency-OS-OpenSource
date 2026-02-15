import { graph } from './graphService';
import { generateAgentResponse } from './geminiService';
import { CommunicationLevel } from '../types';

// --- LEIDEN SERVICE (SEMANTIC CLUSTERING) ---
// "The Cartographer of the Living Graph"
// Uses LLM to group Nodes into Hierarchical Communities (Leiden-style)

interface Community {
    id: string;
    name: string;
    summary: string;
    level: number;
    memberNodeIds: string[];
}

export class LeidenService {

    public async runCommunityDetection() {
        console.log("[LEIDEN] 🗺️ Starting Community Detection...");
        await graph.connect();

        // 1. Fetch all nodes (excluding existing Communities)
        const nodes = await graph.runQuery(`
            MATCH (n) 
            WHERE NOT 'Community' IN labels(n) 
            RETURN n.id as id, labels(n)[0] as label, n.name as name
        `);

        if (nodes.length === 0) {
            console.log("[LEIDEN] ⚠️ Graph is empty. Skipping detection.");
            return;
        }

        const nodeList = nodes.map((n: any) => `${n.name} (${n.label}) [ID:${n.id}]`).join('\n');

        // 2. Ask Gemini to Cluster (Level 1 Communities)
        const prompt = `
        TASK: Perform Hierarchical Community Detection (Leiden-style) on these Knowledge Graph Nodes.
        
        NODES:
        ${nodeList}

        INSTRUCTIONS:
        1. Group these nodes into logical COMMUNITIES based on semantic relatedness.
        2. Each community must have a descriptive NAME and a high-level SUMMARY.
        3. Assign a unique ID (e.g., "comm-01") to each community.
        4. Output strictly valid JSON.

        EXAMPLE OUTPUT:
        {
            "communities": [
                {
                    "id": "comm-frontend",
                    "name": "Frontend Architecture",
                    "summary": "Components related to UI, React, and State Management.",
                    "level": 1,
                    "memberNodeIds": ["node-1", "node-5", "node-9"]
                }
            ]
        }
        `;

        try {
            const response = await generateAgentResponse(
                "LeidenCartographer",
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

            const rawOutput = response.output.trim();

            // Check for API Error
            if (rawOutput.startsWith('Error:') || rawOutput.startsWith('Rate limit')) {
                console.error(`[LEIDEN] ⚠️ LLM API Error: ${rawOutput}`);
                return;
            }

            const jsonStr = rawOutput.replace(/```json/g, '').replace(/```/g, '').trim();

            let data: { communities: Community[] };
            try {
                data = JSON.parse(jsonStr);
            } catch (parseError) {
                console.error("[LEIDEN] ⚠️ JSON Parse Failed. Raw Output:", rawOutput);
                return;
            }

            console.log(`[LEIDEN] 🧩 Identified ${data.communities.length} Communities.`);

            // 3. Write Communities to Neo4j
            for (const comm of data.communities) {
                // Create Community Node
                await graph.createNode('Community', {
                    id: comm.id,
                    name: comm.name,
                    summary: comm.summary,
                    level: comm.level
                }, 'id');

                // Link Members to Community
                for (const nodeId of comm.memberNodeIds) {
                    await graph.createRelationship(nodeId, comm.id, 'BELONGS_TO');
                }
            }

            console.log("[LEIDEN] ✅ Community Structure Persisted.");

        } catch (error) {
            console.error("[LEIDEN] ❌ Detection Failed:", error);
            console.log("[LEIDEN] ⚠️ Switching to HEURISTIC MODE (Offline Fallback)...");
            await this.runHeuristicClustering(nodes);
        }
    }

    private async runHeuristicClustering(nodes: any[]) {
        // Group by Label (Simple Heuristic)
        const clusters = new Map<string, string[]>();

        for (const node of nodes) {
            const label = node.label || 'Unknown';
            if (!clusters.has(label)) clusters.set(label, []);
            clusters.get(label)?.push(node.id);
        }

        for (const [label, memberIds] of clusters.entries()) {
            const commId = `comm-${label.toLowerCase()}`;
            const commName = `${label} Cluster`;
            const commSummary = `Heuristic grouping of all ${label} entities.`;

            await graph.createNode('Community', {
                id: commId,
                name: commName,
                summary: commSummary,
                level: 1
            });

            for (const nodeId of memberIds) {
                await graph.createRelationship(nodeId, commId, 'BELONGS_TO');
            }
        }
        console.log(`[LEIDEN] ✅ Heuristic Clustering Complete. Created ${clusters.size} communities.`);
    }
}

export const leiden = new LeidenService();
