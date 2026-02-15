import { Router } from 'express';
import { GraphController } from '../../controllers/graphController';
import { graph } from '../../../services/graphService';

const router = Router();
const controller = new GraphController();

/**
 * GRAPH ROUTES V2.0 - Extended Graph Database Access
 * 
 * Endpoints:
 * - GET /visualize - Get full graph for visualization
 * - GET /nodes - List all nodes with pagination
 * - GET /stats - Graph statistics
 * - POST /query - Execute custom Cypher query
 * - GET /communities - Get detected communities
 */

// GET /v1/graph/visualize - Full graph for visualization
router.get('/visualize', controller.getGraphVisualization.bind(controller));

// GET /v1/graph/nodes - List nodes with pagination
router.get('/nodes', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const offset = parseInt(req.query.offset as string) || 0;
        const label = req.query.label as string;

        let query: string;
        if (label) {
            query = `MATCH (n:${label}) RETURN n SKIP ${offset} LIMIT ${limit}`;
        } else {
            query = `MATCH (n) RETURN n SKIP ${offset} LIMIT ${limit}`;
        }

        const result = await graph.runQuery(query);
        const nodes = result.map((r: any) => ({
            id: r.n.properties?.id,
            labels: r.n.labels,
            ...r.n.properties
        }));

        res.json({ nodes, count: nodes.length, offset, limit });
    } catch (error: any) {
        console.error('[GRAPH] Error fetching nodes:', error);
        res.status(500).json({ error: 'Failed to fetch nodes', details: error.message });
    }
});

// GET /v1/graph/stats - Graph statistics
router.get('/stats', async (req, res) => {
    try {
        const nodeCountQuery = 'MATCH (n) RETURN count(n) as nodeCount';
        const relCountQuery = 'MATCH ()-[r]->() RETURN count(r) as relCount';
        const labelsQuery = 'CALL db.labels() YIELD label RETURN collect(label) as labels';
        const relTypesQuery = 'CALL db.relationshipTypes() YIELD relationshipType RETURN collect(relationshipType) as types';

        const [nodeResult, relResult, labelsResult, typesResult] = await Promise.all([
            graph.runQuery(nodeCountQuery),
            graph.runQuery(relCountQuery),
            graph.runQuery(labelsQuery),
            graph.runQuery(relTypesQuery)
        ]);

        res.json({
            nodeCount: nodeResult[0]?.nodeCount || 0,
            relationshipCount: relResult[0]?.relCount || 0,
            labels: labelsResult[0]?.labels || [],
            relationshipTypes: typesResult[0]?.types || []
        });
    } catch (error: any) {
        console.error('[GRAPH] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch graph stats', details: error.message });
    }
});

// POST /v1/graph/query - Execute custom Cypher query (read-only for safety)
router.post('/query', async (req, res) => {
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // Safety: Only allow read operations
        const lowerQuery = query.toLowerCase().trim();
        if (lowerQuery.includes('create') ||
            lowerQuery.includes('delete') ||
            lowerQuery.includes('merge') ||
            lowerQuery.includes('set') ||
            lowerQuery.includes('remove')) {
            return res.status(403).json({
                error: 'Write operations not allowed through this endpoint',
                hint: 'Only MATCH and RETURN queries are permitted'
            });
        }

        const result = await graph.runQuery(query);
        res.json({ result, count: result.length });
    } catch (error: any) {
        console.error('[GRAPH] Query execution error:', error);
        res.status(500).json({ error: 'Query execution failed', details: error.message });
    }
});

// GET /v1/graph/communities - Get detected communities
router.get('/communities', async (req, res) => {
    try {
        // Query for nodes grouped by their community if available
        const query = `
            MATCH (n)
            WHERE n.community IS NOT NULL
            RETURN n.community as community, collect(n.id) as members
            ORDER BY size(collect(n.id)) DESC
            LIMIT 50
        `;

        const result = await graph.runQuery(query);
        const communities = result.map((r: any) => ({
            id: r.community,
            members: r.members,
            size: r.members.length
        }));

        res.json({ communities, count: communities.length });
    } catch (error: any) {
        console.error('[GRAPH] Error fetching communities:', error);
        res.status(500).json({ error: 'Failed to fetch communities' });
    }
});

// GET /v1/graph/neighbors/:nodeId - Get neighbors of a specific node
router.get('/neighbors/:nodeId', async (req, res) => {
    try {
        const { nodeId } = req.params;
        const depth = parseInt(req.query.depth as string) || 1;

        const query = `
            MATCH (n {id: $nodeId})-[r*1..${depth}]-(m)
            RETURN DISTINCT m.id as nodeId, labels(m) as labels, m as node
            LIMIT 100
        `;

        const result = await graph.runQuery(query, { nodeId });
        const neighbors = result.map((r: any) => ({
            id: r.nodeId,
            labels: r.labels,
            ...r.node.properties
        }));

        res.json({ nodeId, neighbors, count: neighbors.length, depth });
    } catch (error: any) {
        console.error('[GRAPH] Error fetching neighbors:', error);
        res.status(500).json({ error: 'Failed to fetch neighbors' });
    }
});

// GET /v1/graph/health - Hub network health metrics
router.get('/health', async (req, res) => {
    try {
        const { hubStrengthening } = await import('../../../services/hubStrengtheningService');
        const health = await hubStrengthening.getNetworkHealth();

        // Get top hubs with their labels
        const hubs = await graph.getHubs(10);
        const hubDetails = hubs.map(h => ({
            id: h.id,
            label: h.label || h.content?.substring(0, 50) || h.id,
            degree: h.degree
        }));

        // Get connections at risk (low weight)
        const atRiskQuery = `
            MATCH (a)-[r]-(b)
            WHERE r.weight IS NOT NULL AND r.weight < 0.15
            RETURN a.id as source, b.id as target, r.weight as weight
            LIMIT 10
        `;
        const atRiskResult = await graph.runQuery(atRiskQuery, {});
        const connectionsAtRisk = atRiskResult.map((r: any) => ({
            source: r.source,
            target: r.target,
            weight: r.weight
        }));

        res.json({
            status: 'healthy',
            metrics: {
                totalNodes: health.totalNodes,
                totalEdges: health.totalEdges,
                avgDegree: Math.round(health.avgDegree * 100) / 100,
                hubCount: health.hubCount,
                weakConnections: health.weakConnectionsCount,
                reinforcementQueueSize: health.queueSize
            },
            topHubs: hubDetails,
            connectionsAtRisk,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[GRAPH] Error fetching health:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch network health',
            details: error.message
        });
    }
});

// GET /v1/graph/hubs - Get top hub nodes
router.get('/hubs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;
        const hubs = await graph.getHubs(limit);

        res.json({
            hubs: hubs.map(h => ({
                id: h.id,
                label: h.label || h.content?.substring(0, 100) || h.id,
                degree: h.degree,
                properties: h
            })),
            count: hubs.length
        });
    } catch (error: any) {
        console.error('[GRAPH] Error fetching hubs:', error);
        res.status(500).json({ error: 'Failed to fetch hubs', details: error.message });
    }
});

export default router;
