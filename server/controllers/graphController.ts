import { Request, Response } from 'express';
import { graph } from '../../services/graphService';

export class GraphController {

    // [GET] /visualize
    public async getGraphVisualization(req: Request, res: Response) {
        try {
            // Fetch Nodes - use property n.id (application ID) NOT id() (Neo4j internal)
            const nodeQuery = `
                MATCH (n)
                WHERE n.id IS NOT NULL
                RETURN n.id as nodeId, n, labels(n) as labels 
                LIMIT 500
            `;

            // Fetch Relationships - use property IDs for consistency
            const linkQuery = `
                MATCH (n)-[r]->(m) 
                WHERE n.id IS NOT NULL AND m.id IS NOT NULL
                RETURN n.id as source, m.id as target, type(r) as type 
                LIMIT 1000
            `;

            const nodesData = await graph.runQuery(nodeQuery);
            const linksData = await graph.runQuery(linkQuery);

            // Create node ID set for validation
            const nodeIdSet = new Set<string>();

            const nodes = nodesData.map((record: any) => {
                const n = record.n;
                const labels = record.labels;
                const nodeId = record.nodeId; // Already a string (property value)
                nodeIdSet.add(nodeId);
                return {
                    id: nodeId,
                    label: labels[0] || 'Unknown',
                    name: n.properties?.name || n.properties?.id || 'Unnamed',
                    ...n.properties
                };
            });

            // Filter links to only include those referencing existing nodes
            const links = linksData
                .map((record: any) => ({
                    source: record.source,
                    target: record.target,
                    type: record.type
                }))
                .filter((link: any) => nodeIdSet.has(link.source) && nodeIdSet.has(link.target));

            res.json({
                nodes,
                links
            });

        } catch (error: any) {
            console.error("[GRAPH_CONTROLLER] Error fetching graph:", error);
            res.status(500).json({ error: "Failed to fetch graph data", details: error.message });
        }
    }
}
