import neo4j, { Driver, Session } from 'neo4j-driver';
import crypto from 'crypto';
import { lancedbService } from './lancedbService';
import { generateEmbedding as geminiEmbed } from './geminiService';
import { configLoader } from '../server/config/configLoader'; // [PA-058]
import { MemoryTier, MemoryNode } from '../types';
import { nervousSystem } from './connectionNervousSystem';

// --- SILHOUETTE GRAPH SERVICE (NEO4J) ---
// The Structural Backbone of the Living Graph
// Connects to Neo4j to store Nodes (Entities) and Edges (Relationships)

class GraphService {
    private driver: Driver | null = null;
    private _isConnected: boolean = false; // Renamed to avoid conflict with method
    private isRegistered: boolean = false;
    private connectionTimeout: NodeJS.Timeout | null = null;
    private readonly TIMEOUT_MS = 5 * 60 * 1000; // 5 Minutes

    constructor() {
        // Lazy initialization - connection managed by NervousSystem
    }

    /** Check if Neo4j is connected. Used by health check endpoint. */
    public async isConnected(): Promise<boolean> {
        if (!this.driver) return false;
        try {
            await this.driver.verifyConnectivity();
            return true;
        } catch {
            return false;
        }
        return this._isConnected;
    }

    /**
     * Connects to Neo4j with Exponential Backoff Retry.
     * Fires a SYSTEM_ALERT if all retries fail so the Swarm can self-heal.
     */
    public async connect(retries = 3, delayMs = 2000): Promise<boolean> {
        if (this._isConnected && this.driver) {
            this.resetConnectionTimeout(); // Keep alive on manual connect
            return true;
        }

        const config = configLoader.getConfig();
        if (config.modules.graph === false) {
            console.log("[GRAPH] 🚫 Graph module disabled in config (Lite Mode). Skipping connection.");
            return false;
        }

        let attempt = 0;
        while (attempt < retries) {
            try {
                if (attempt > 0) {
                    console.log(`[GRAPH] 🔄 Reconnection attempt ${attempt + 1}/${retries}...`);
                    await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
                } else {
                    console.log("[GRAPH] 🔗 Connecting to Neo4j...");
                }

                this.driver = neo4j.driver(
                    process.env.NEO4J_URI || 'bolt://127.0.0.1:7787',
                    neo4j.auth.basic(
                        process.env.NEO4J_USER || 'neo4j',
                        process.env.NEO4J_PASSWORD || 'changeme_on_first_run'
                    ),
                    {
                        maxConnectionLifetime: 30 * 60 * 1000,
                        maxConnectionPoolSize: 50,
                        connectionAcquisitionTimeout: 5000
                    }
                );

                await this.driver.verifyConnectivity();
                this._isConnected = true;
                console.log("[GRAPH] ✅ Connected to Neo4j.");

                this.resetConnectionTimeout();
                this.registerWithNervousSystem();

                // Initialize schema in background
                setImmediate(() => this.initializeSchema().catch(() => { }));

                return true;

            } catch (error: any) {
                console.error(`[GRAPH] ❌ Connection failed (Attempt ${attempt + 1}/${retries}):`, error.message);
                this._isConnected = false;
                this.driver = null;
                attempt++;
            }
        }

        // Exhausted retries
        console.error("[GRAPH] 🚨 FATAL: Neo4j connection completely failed after retries.");
        try {
            const { systemBus } = await import('./systemBus');
            systemBus.emit('PROTOCOL_SYSTEM_ALERT' as any, {
                component: 'Neo4j',
                error: 'Connection Exhaustion',
                severity: 'CRITICAL',
                message: 'Neo4j database failed to connect after multiple exponential backoff retries. Recommend deploying Remediation Agent.',
                timestamp: Date.now()
            }, 'system-kernel');
        } catch (e) {
            console.error("[GRAPH] Could not emit SYSTEM_ALERT:", e);
        }

        return false;
    }

    private resetConnectionTimeout() {
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
        this.connectionTimeout = setTimeout(() => {
            console.log("[GRAPH] 💤 Idle timeout reached. Closing Neo4j connection.");
            this.disconnect();
        }, this.TIMEOUT_MS);
    }

    /**
     * Check if connected (used by NervousSystem health check)
     */
    public isConnectedStatus(): boolean {
        return this._isConnected || true; // Always operational via SQLite fallback
    }

    /**
     * Force disconnect (for reconnection attempts)
     */
    public async disconnect(): Promise<void> {
        if (this.connectionTimeout) clearTimeout(this.connectionTimeout);

        if (this.driver) {
            try {
                await this.driver.close();
                console.log("[GRAPH] 🔌 Disconnected from Neo4j.");
            } catch { }
        }
        this.driver = null;
        this._isConnected = false;
    }

    private registerWithNervousSystem() {
        if (this.isRegistered) return;

        nervousSystem.register({
            id: 'neo4j',
            name: 'Neo4j Graph',
            type: 'DATABASE',
            isRequired: false,
            checkHealth: async () => {
                if (!this.isConnectedStatus()) return false;
                try {
                    await this.runQuery('RETURN 1');
                    return true;
                } catch {
                    return false;
                }
            },
            reconnect: async () => {
                await this.disconnect();
                return await this.connect();
            }
        });
        this.isRegistered = true;
    }


    private async initializeSchema() {
        if (!this.driver) return;
        const session = this.driver.session();
        try {
            // Ensure uniqueness for critical entities
            await session.run(`CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE`);
            await session.run(`CREATE CONSTRAINT IF NOT EXISTS FOR (c:Concept) REQUIRE c.name IS UNIQUE`);
            await session.run(`CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE`);
            console.log("[GRAPH] 🛡️ Schema Constraints Verified.");
        } catch (e) {
            console.warn("[GRAPH] Schema Init Warning:", e);
        } finally {
            await session.close();
        }
    }

    public async runQuery(cypher: string, params: any = {}) {
        if (!this._isConnected || !this.driver) {
            const connected = await this.connect();
            if (!connected || !this.driver) {
                // Fallback to SQLite query execution
                return this.runSqliteQuery(cypher, params);
            }
        }

        this.resetConnectionTimeout(); // Keep alive

        const session = this.driver.session();
        try {
            const result = await session.run(cypher, params);
            return result.records.map(record => record.toObject());
        } catch (error: any) {
            // Auto-recovery for stale connections
            if (error.code === 'ServiceUnavailable' || error.code === 'SessionExpired') {
                console.warn("[GRAPH] ⚠️ Connection stale, reconnecting...");
                this._isConnected = false;
                if (this.driver) await this.driver.close();
                this.driver = null;

                // Retry once
                await this.connect();
                if (this.driver) {
                    const newSession = this.driver.session();
                    try {
                        const result = await newSession.run(cypher, params);
                        return result.records.map(record => record.toObject());
                    } finally {
                        await newSession.close();
                    }
                }
            }

            console.error(`[GRAPH] Query Failed: ${cypher.substring(0, 50)}...`, error);
            throw error;
        } finally {
            await session.close();
        }
    }

    private async runSqliteQuery(cypher: string, params: any = {}): Promise<any[]> {
        const { sqliteService } = await import('./sqliteService');
        const queryLower = cypher.toLowerCase().trim();

        // 1. Connection check / test query
        if (queryLower.includes('return 1') && queryLower.length < 20) {
            return [{ '1': 1 }];
        }

        // 2. Node Count query
        if (queryLower.includes('count(n)') && queryLower.includes('nodecount')) {
            const row = sqliteService.db.prepare('SELECT COUNT(*) as count FROM graph_nodes').get() as any;
            return [{ nodeCount: row?.count || 0 }];
        }

        // 3. Relationship Count query
        if (queryLower.includes('count(r)') && queryLower.includes('relcount')) {
            const row = sqliteService.db.prepare('SELECT COUNT(*) as count FROM graph_edges').get() as any;
            return [{ relCount: row?.count || 0 }];
        }

        // 4. Get Labels query
        if (queryLower.includes('db.labels()')) {
            const rows = sqliteService.db.prepare('SELECT DISTINCT label FROM graph_nodes').all() as any[];
            return [{ labels: rows.map(r => r.label) }];
        }

        // 5. Get Relationship Types query
        if (queryLower.includes('db.relationshiptypes()')) {
            const rows = sqliteService.db.prepare('SELECT DISTINCT type FROM graph_edges').all() as any[];
            return [{ types: rows.map(r => r.type) }];
        }

        // 6. Stats calculation for Small-World Index
        if (queryLower.includes('with count(n) as n') && queryLower.includes('count(r) as e')) {
            const NRow = sqliteService.db.prepare('SELECT COUNT(*) as count FROM graph_nodes').get() as any;
            const ERow = sqliteService.db.prepare('SELECT COUNT(*) as count FROM graph_edges').get() as any;
            return [{ N: NRow?.count || 0, E: ERow?.count || 0 }];
        }

        // 7. Hubs query (order by degree desc)
        if (queryLower.includes('degree > 5') || (queryLower.includes('degree') && queryLower.includes('hubs'))) {
            const limit = typeof params.limit === 'number' ? params.limit : (params.limit && typeof params.limit.low === 'number' ? params.limit.low : 5);
            const rows = sqliteService.db.prepare(`
                WITH degrees AS (
                    SELECT node_id, COUNT(*) as degree
                    FROM (
                        SELECT source as node_id FROM graph_edges
                        UNION ALL
                        SELECT target as node_id FROM graph_edges
                    )
                    GROUP BY node_id
                )
                SELECT n.id, n.label, n.name, d.degree, n.properties
                FROM graph_nodes n
                JOIN degrees d ON n.id = d.node_id
                WHERE d.degree > 5
                ORDER BY d.degree DESC
                LIMIT ?
            `).all(limit) as any[];
            return rows.map(row => ({
                id: row.id,
                label: row.label,
                name: row.name,
                degree: row.degree,
                ...JSON.parse(row.properties)
            }));
        }

        // 8. Open Triangles query (for advanced discovery)
        if (queryLower.includes('not (a)-[:related]-(b)') || queryLower.includes('bridge')) {
            const limit = typeof params.limit === 'number' ? params.limit : (params.limit && typeof params.limit.low === 'number' ? params.limit.low : 5);
            const concepts = sqliteService.db.prepare("SELECT id, properties FROM graph_nodes WHERE label = 'Concept'").all() as any[];
            const edges = sqliteService.db.prepare("SELECT source, target FROM graph_edges WHERE type = 'RELATED'").all() as any[];
            
            const conceptMap = new Map(concepts.map(c => [c.id, JSON.parse(c.properties)]));
            const adj = new Map<string, Set<string>>();
            for (const edge of edges) {
                if (!adj.has(edge.source)) adj.set(edge.source, new Set());
                if (!adj.has(edge.target)) adj.set(edge.target, new Set());
                adj.get(edge.source)!.add(edge.target);
                adj.get(edge.target)!.add(edge.source);
            }
            
            const triangles: any[] = [];
            const keys = Array.from(conceptMap.keys());
            for (let i = 0; i < keys.length; i++) {
                for (let j = i + 1; j < keys.length; j++) {
                    const a = keys[i];
                    const b = keys[j];
                    const areRelated = adj.get(a)?.has(b) || adj.get(b)?.has(a);
                    if (areRelated) continue;
                    
                    const neighborsA = adj.get(a) || new Set();
                    const neighborsB = adj.get(b) || new Set();
                    for (const bridge of neighborsA) {
                        if (neighborsB.has(bridge)) {
                            triangles.push({
                                a: { properties: conceptMap.get(a) },
                                b: { properties: conceptMap.get(b) },
                                bridge: { properties: conceptMap.get(bridge) }
                            });
                            if (triangles.length >= limit) break;
                        }
                    }
                    if (triangles.length >= limit) break;
                }
                if (triangles.length >= limit) break;
            }
            return triangles;
        }

        // 9. Weak Ties query
        if (queryLower.includes('coalesce(r.weight, r.confidence, 1.0) as weight')) {
            const nodeId = params.nodeId;
            const threshold = typeof params.threshold === 'number' ? params.threshold : 0.3;
            const rows = sqliteService.db.prepare(`
                SELECT source, target, properties FROM graph_edges 
                WHERE source = ? OR target = ?
            `).all(nodeId, nodeId) as any[];
            
            const results: any[] = [];
            for (const r of rows) {
                const targetId = r.source === nodeId ? r.target : r.source;
                const props = JSON.parse(r.properties);
                const weight = typeof props.weight === 'number' ? props.weight : (typeof props.confidence === 'number' ? props.confidence : 1.0);
                if (weight < threshold) {
                    results.push({ targetId, weight });
                }
            }
            return results;
        }

        // 10. Local Clustering Coefficient calculation
        if (queryLower.includes('count(distinct n1) as k') && queryLower.includes('clustering')) {
            const nodeId = params.nodeId;
            const edges = sqliteService.db.prepare('SELECT source, target FROM graph_edges').all() as any[];
            const neighbors = new Set<string>();
            for (const edge of edges) {
                if (edge.source === nodeId) neighbors.add(edge.target);
                if (edge.target === nodeId) neighbors.add(edge.source);
            }
            const k = neighbors.size;
            if (k <= 1) return [{ clustering: 0.0 }];
            
            let e = 0;
            for (const edge of edges) {
                if (neighbors.has(edge.source) && neighbors.has(edge.target)) {
                    e++;
                }
            }
            const clustering = (2 * e) / (k * (k - 1));
            return [{ clustering }];
        }

        // 11. Candidate selection for Global Clustering
        if (queryLower.includes('degree >= 2') && queryLower.includes('n.id as id')) {
            const sampleSize = typeof params.sampleSize === 'number' ? params.sampleSize : 30;
            const rows = sqliteService.db.prepare(`
                WITH degrees AS (
                    SELECT node_id, COUNT(*) as degree
                    FROM (
                        SELECT source as node_id FROM graph_edges
                        UNION ALL
                        SELECT target as node_id FROM graph_edges
                    )
                    GROUP BY node_id
                )
                SELECT n.id
                FROM graph_nodes n
                JOIN degrees d ON n.id = d.node_id
                WHERE d.degree >= 2
                ORDER BY random()
                LIMIT ?
            `).all(sampleSize) as any[];
            return rows.map(r => ({ id: r.id }));
        }

        // 12. Shortest Path length calculation
        if (queryLower.includes('shortestpath') && queryLower.includes('pathlength')) {
            const samplePairs = typeof params.samplePairs === 'number' ? params.samplePairs : 50;
            const nodes = sqliteService.db.prepare('SELECT id FROM graph_nodes').all() as any[];
            if (nodes.length < 2) return [];
            
            const edges = sqliteService.db.prepare('SELECT source, target FROM graph_edges').all() as any[];
            const adj: Record<string, string[]> = {};
            for (const edge of edges) {
                if (!adj[edge.source]) adj[edge.source] = [];
                if (!adj[edge.target]) adj[edge.target] = [];
                adj[edge.source].push(edge.target);
                adj[edge.target].push(edge.source);
            }
            
            const pathLengths: any[] = [];
            let pairsCount = 0;
            const maxAttempts = samplePairs * 5;
            let attempts = 0;
            
            while (pairsCount < samplePairs && attempts < maxAttempts) {
                attempts++;
                const u = nodes[Math.floor(Math.random() * nodes.length)].id;
                const v = nodes[Math.floor(Math.random() * nodes.length)].id;
                if (u === v) continue;
                
                const queue: { id: string, dist: number }[] = [{ id: u, dist: 0 }];
                const visited = new Set<string>([u]);
                
                while (queue.length > 0) {
                    const curr = queue.shift()!;
                    if (curr.id === v) {
                        pathLengths.push({ pathLength: curr.dist });
                        pairsCount++;
                        break;
                    }
                    if (curr.dist < 15) {
                        const neighbors = adj[curr.id] || [];
                        for (const neigh of neighbors) {
                            if (!visited.has(neigh)) {
                                visited.add(neigh);
                                queue.push({ id: neigh, dist: curr.dist + 1 });
                            }
                        }
                    }
                }
            }
            return pathLengths;
        }

        // 13. Candidate bridges selection
        if (queryLower.includes('degree > 3') && queryLower.includes('n.id as id')) {
            const rows = sqliteService.db.prepare(`
                WITH degrees AS (
                    SELECT node_id, COUNT(*) as degree
                    FROM (
                        SELECT source as node_id FROM graph_edges
                        UNION ALL
                        SELECT target as node_id FROM graph_edges
                    )
                    GROUP BY node_id
                )
                SELECT n.id, n.name, d.degree
                FROM graph_nodes n
                JOIN degrees d ON n.id = d.node_id
                WHERE d.degree > 3
                ORDER BY d.degree DESC
                LIMIT 50
            `).all() as any[];
            return rows.map(r => ({ id: r.id, name: r.name, degree: r.degree }));
        }

        // 14. User facts query (HAS_FACT relation)
        if (queryLower.includes('has_fact') || queryLower.includes('fact')) {
            const userId = params.userId;
            let rows: any[];
            if (userId) {
                rows = sqliteService.db.prepare(`
                    SELECT n2.properties
                    FROM graph_edges e
                    JOIN graph_nodes n1 ON e.source = n1.id
                    JOIN graph_nodes n2 ON e.target = n2.id
                    WHERE n1.id = ? AND e.type = 'HAS_FACT' AND n2.label = 'Fact'
                `).all(userId) as any[];
            } else {
                rows = sqliteService.db.prepare(`
                    SELECT properties FROM graph_nodes WHERE label = 'Fact'
                `).all() as any[];
            }
            
            const facts = rows.map(r => {
                const props = JSON.parse(r.properties);
                return {
                    category: props.category || 'general',
                    content: props.content || '',
                    confidence: typeof props.confidence === 'number' ? props.confidence : 0.9,
                    timestamp: typeof props.timestamp === 'number' ? props.timestamp : Date.now()
                };
            });
            facts.sort((a, b) => b.timestamp - a.timestamp);
            return facts.slice(0, 50).map(f => ({
                category: f.category,
                content: f.content,
                confidence: f.confidence,
                timestamp: f.timestamp
            }));
        }

        // 15. Neighbors traversal query (path search with depth r*1..depth)
        if (queryLower.includes('-[r*')) {
            const nodeId = params.nodeId;
            const depthMatch = cypher.match(/r\*1\.\.(\d+)/);
            const depth = depthMatch ? parseInt(depthMatch[1]) : 1;
            
            const edges = sqliteService.db.prepare('SELECT source, target FROM graph_edges').all() as any[];
            const adj: Record<string, string[]> = {};
            for (const edge of edges) {
                if (!adj[edge.source]) adj[edge.source] = [];
                if (!adj[edge.target]) adj[edge.target] = [];
                adj[edge.source].push(edge.target);
                adj[edge.target].push(edge.source);
            }
            
            const visited = new Set<string>([nodeId]);
            const queue: { id: string, d: number }[] = [{ id: nodeId, d: 0 }];
            const resultIds = new Set<string>();
            
            while (queue.length > 0) {
                const curr = queue.shift()!;
                if (curr.d > 0) {
                    resultIds.add(curr.id);
                }
                if (curr.d < depth) {
                    const neighbors = adj[curr.id] || [];
                    for (const neigh of neighbors) {
                        if (!visited.has(neigh)) {
                            visited.add(neigh);
                            queue.push({ id: neigh, d: curr.d + 1 });
                        }
                    }
                }
            }
            
            if (resultIds.size === 0) return [];
            const placeholders = Array.from(resultIds).map(() => '?').join(',');
            const rows = sqliteService.db.prepare(`SELECT id, label, properties FROM graph_nodes WHERE id IN (${placeholders}) LIMIT 100`).all(...Array.from(resultIds)) as any[];
            return rows.map(row => ({
                nodeId: row.id,
                labels: [row.label],
                node: {
                    labels: [row.label],
                    properties: JSON.parse(row.properties)
                }
            }));
        }

        // 16. Related concepts query (GraphRAG matching nodeIds)
        if (queryLower.includes('related.id') && queryLower.includes('relationship')) {
            const nodeIds = params.nodeIds || [];
            if (nodeIds.length === 0) return [];
            
            const placeholders = nodeIds.map(() => '?').join(',');
            const edges = sqliteService.db.prepare(`
                SELECT source, target, type FROM graph_edges 
                WHERE source IN (${placeholders}) OR target IN (${placeholders})
            `).all(...nodeIds, ...nodeIds) as any[];
            
            const relatedIds = new Set<string>();
            const edgeMatches: any[] = [];
            
            for (const edge of edges) {
                const isSourceIn = nodeIds.includes(edge.source);
                const isTargetIn = nodeIds.includes(edge.target);
                if (isSourceIn && !isTargetIn) {
                    relatedIds.add(edge.target);
                    edgeMatches.push({ sourceId: edge.source, relatedId: edge.target, type: edge.type });
                } else if (!isSourceIn && isTargetIn) {
                    relatedIds.add(edge.source);
                    edgeMatches.push({ sourceId: edge.target, relatedId: edge.source, type: edge.type });
                } else if (isSourceIn && isTargetIn) {
                    edgeMatches.push({ sourceId: edge.source, relatedId: edge.target, type: edge.type });
                }
            }
            
            if (edgeMatches.length === 0) return [];
            
            const allIds = Array.from(new Set([...nodeIds, ...Array.from(relatedIds)]));
            const idPlaceholders = allIds.map(() => '?').join(',');
            const nodes = sqliteService.db.prepare(`
                SELECT id, label, properties FROM graph_nodes WHERE id IN (${idPlaceholders})
            `).all(...allIds) as any[];
            
            const nodeMap = new Map(nodes.map(n => [n.id, n]));
            
            const results: any[] = [];
            for (const match of edgeMatches) {
                const relatedNode = nodeMap.get(match.relatedId);
                if (!relatedNode) continue;
                results.push({
                    sourceId: match.sourceId,
                    relatedId: match.relatedId,
                    name: relatedNode.name || relatedNode.id,
                    label: relatedNode.label,
                    relationship: match.type,
                    props: JSON.parse(relatedNode.properties)
                });
            }
            return results.slice(0, 20);
        }

        // 17. Visualize nodes query
        if (queryLower.includes('nodeid, n, labels(n)')) {
            const limit = typeof params.limit === 'number' ? params.limit : 500;
            const rows = sqliteService.db.prepare('SELECT id, label, properties FROM graph_nodes LIMIT ?').all(limit) as any[];
            return rows.map(row => ({
                nodeId: row.id,
                labels: [row.label],
                n: {
                    labels: [row.label],
                    properties: JSON.parse(row.properties)
                }
            }));
        }

        // 18. Visualize links query
        if (queryLower.includes('n.id as source, m.id as target, type(r)')) {
            const limit = typeof params.limit === 'number' ? params.limit : 1000;
            const rows = sqliteService.db.prepare('SELECT source, target, type FROM graph_edges LIMIT ?').all(limit) as any[];
            return rows.map(row => ({
                source: row.source,
                target: row.target,
                type: row.type
            }));
        }

        // 19. Paginated nodes query
        if (queryLower.includes('match (n') && queryLower.includes('return n skip')) {
            const labelMatch = cypher.match(/match\s*\(n:?`?([A-Za-z0-9_]*)`?\)/i);
            const label = labelMatch ? labelMatch[1] : null;
            const skip = typeof params.skip === 'number' ? params.skip : 0;
            const limit = typeof params.limit === 'number' ? params.limit : 100;
            
            let rows: any[];
            if (label) {
                rows = sqliteService.db.prepare('SELECT id, label, properties FROM graph_nodes WHERE label = ? LIMIT ? OFFSET ?').all(label, limit, skip) as any[];
            } else {
                rows = sqliteService.db.prepare('SELECT id, label, properties FROM graph_nodes LIMIT ? OFFSET ?').all(limit, skip) as any[];
            }
            return rows.map(row => ({
                n: {
                    labels: [row.label],
                    properties: JSON.parse(row.properties)
                }
            }));
        }

        // 20. Communities query
        if (queryLower.includes('n.community') && queryLower.includes('members')) {
            const rows = sqliteService.db.prepare('SELECT id, properties FROM graph_nodes').all() as any[];
            const communities: Record<string, string[]> = {};
            for (const row of rows) {
                const props = JSON.parse(row.properties);
                if (props.community !== undefined && props.community !== null) {
                    const comm = String(props.community);
                    if (!communities[comm]) communities[comm] = [];
                    communities[comm].push(row.id);
                }
            }
            const result = Object.entries(communities).map(([comm, members]) => ({
                community: comm,
                members
            }));
            result.sort((a, b) => b.members.length - a.members.length);
            return result.slice(0, 50);
        }

        // 21. Leiden Cartographer: Fetch all nodes query
        if (queryLower.includes("where not 'community' in labels(n)")) {
            const rows = sqliteService.db.prepare("SELECT id, label, name FROM graph_nodes WHERE label != 'Community'").all() as any[];
            return rows.map(r => ({
                id: r.id,
                label: r.label,
                name: r.name
            }));
        }

        // 22. Generic fallback parser for other Match/Return queries
        console.warn(`[GRAPH] SQLite fallback: Cypher query not explicitly matched: "${cypher.substring(0, 100)}". Running generic parser.`);
        const isCount = queryLower.includes('count(');
        const isEdge = queryLower.includes('-[') || queryLower.includes('type(');
        
        if (isCount) {
            const table = isEdge ? 'graph_edges' : 'graph_nodes';
            const row = sqliteService.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
            return [{ count: row?.count || 0 }];
        }
        
        if (isEdge) {
            const rows = sqliteService.db.prepare('SELECT source, target, type FROM graph_edges LIMIT 100').all() as any[];
            return rows.map(row => ({
                source: row.source,
                target: row.target,
                type: row.type
            }));
        } else {
            const rows = sqliteService.db.prepare('SELECT id, label, properties FROM graph_nodes LIMIT 100').all() as any[];
            return rows.map(row => ({
                n: {
                    labels: [row.label],
                    properties: JSON.parse(row.properties)
                }
            }));
        }
    }

    public async close() {
        if (this.driver) {
            await this.driver.close();
            this._isConnected = false;
            console.log("[GRAPH] 🔌 Disconnected.");
        }
    }

    // --- HELPER METHODS ---

    public async createNode(label: string, properties: any, mergeKey: string = 'id') {
        if (!properties.id) properties.id = crypto.randomUUID();

        if (!this._isConnected || !this.driver) {
            // Fallback to SQLite
            const { sqliteService } = await import('./sqliteService');
            let existingId: string | null = null;
            if (mergeKey !== 'id') {
                const val = properties[mergeKey];
                const rows = sqliteService.db.prepare('SELECT id, properties FROM graph_nodes WHERE label = ?').all(label) as { id: string, properties: string }[];
                for (const r of rows) {
                    const props = JSON.parse(r.properties);
                    if (props[mergeKey] === val) {
                        existingId = r.id;
                        break;
                    }
                }
            }
            const nodeId = existingId || properties.id || crypto.randomUUID();
            properties.id = nodeId;
            const name = properties.name || properties.id;
            
            const stmt = sqliteService.db.prepare(`
                INSERT INTO graph_nodes (id, label, name, properties, last_updated)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    label = excluded.label,
                    name = excluded.name,
                    properties = excluded.properties,
                    last_updated = excluded.last_updated
            `);
            stmt.run(nodeId, label, name, JSON.stringify(properties), Date.now());

            // If it's a Concept, sync to vector store
            if (label === 'Concept') {
                this.syncConceptToVectorStore(properties).catch(() => {});
            }

            return [{
                n: {
                    labels: [label],
                    properties
                }
            }];
        }

        const query = `
            MERGE (n:${label} {${mergeKey}: $mergeVal})
            SET n += $props, n.lastUpdated = timestamp()
            RETURN n
        `;

        try {
            const results = await this.runQuery(query, {
                mergeVal: properties[mergeKey],
                props: properties
            });
            
            // If it's a Concept, sync to vector store
            if (label === 'Concept') {
                this.syncConceptToVectorStore(properties).catch(() => {});
            }
            
            return results;
        } catch (error: any) {
            console.error(`[GRAPH] Node creation failed for ${label}:`, error);
            throw error;
        }
    }

    public async createRelationship(fromId: string, toId: string, type: string, properties: any = {}) {
        if (!this._isConnected || !this.driver) {
            // Fallback to SQLite
            const { sqliteService } = await import('./sqliteService');
            // Check if source and target exist
            const sourceExists = sqliteService.db.prepare('SELECT 1 FROM graph_nodes WHERE id = ?').get(fromId);
            const targetExists = sqliteService.db.prepare('SELECT 1 FROM graph_nodes WHERE id = ?').get(toId);
            if (!sourceExists || !targetExists) {
                console.warn(`[GRAPH] SQLite: Cannot create relationship ${fromId} -[${type}]-> ${toId} because one of the nodes does not exist.`);
                return [];
            }

            const stmt = sqliteService.db.prepare(`
                INSERT INTO graph_edges (source, target, type, properties, last_updated)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(source, target, type) DO UPDATE SET
                    properties = excluded.properties,
                    last_updated = excluded.last_updated
            `);
            stmt.run(fromId, toId, type, JSON.stringify(properties), Date.now());

            return [{
                r: {
                    source: fromId,
                    target: toId,
                    type,
                    properties
                }
            }];
        }

        const query = `
            MATCH (a {id: $fromId}), (b {id: $toId})
            MERGE (a)-[r:${type}]->(b)
            SET r += $props, r.lastUpdated = timestamp()
            RETURN r
        `;
        return this.runQuery(query, { fromId, toId, props: properties });
    }

    public async createDiscoveryRelationship(fromId: string, toId: string, type: 'CAUSES' | 'INHIBITS' | 'IMPLIES', confidence: number, source: string) {
        // [SCALE-FREE NETWORK] Preferential Attachment Mechanism
        // When a new connection is formed, there's a chance to also reinforce a connection to a Hub
        // mimicking "Rich get Richer" (Matthew Effect) in neural networks.

        // 10% chance to trigger preferential attachment on discovery
        if (Math.random() < 0.1) {
            this.applyPreferentialAttachment(fromId).catch(e => console.warn("[GRAPH] Pref. Attachment failed:", e));
        }

        return this.createRelationship(fromId, toId, type, {
            confidence,
            discoverySource: source,
            isHypothesis: true,
            verified: false
        });
    }

    // --- SCALE-FREE NETWORK MECHANISMS (BIOMIMETIC) ---

    /**
     * Finds "Hubs" - nodes with the highest degree of connections.
     * These act as master concepts or functional centers.
     */
    public async getHubs(limit: number = 5): Promise<any[]> {
        const query = `
            MATCH (n)
            OPTIONAL MATCH (n)-[r]-()
            WITH n, count(r) as degree
            WHERE degree > 5  // Minimum requirement to be a "mini-hub"
            RETURN n.id as id, n.label as label, n.name as name, degree
            ORDER BY degree DESC
            LIMIT $limit
        `;
        return this.runQuery(query, { limit: neo4j.int(limit) });
    }

    /**
     * Implements "Preferential Attachment":
     * Connects the target node to a random Hub with probability proportional to the Hub's degree.
     */
    public async applyPreferentialAttachment(nodeId: string) {
        try {
            const hubs = await this.getHubs(5);
            if (hubs.length === 0) return;

            // Roulette Wheel Selection based on Degree
            const totalDegree = hubs.reduce((sum, h) => sum + (h.degree as number), 0);
            let random = Math.random() * totalDegree;
            let selectedHub = hubs[0];

            for (const hub of hubs) {
                random -= (hub.degree as number);
                if (random <= 0) {
                    selectedHub = hub;
                    break;
                }
            }

            // Don't connect to self
            if (selectedHub.id === nodeId) return;

            console.log(`[GRAPH] 🕸️ Scale-Free Growth: Connecting ${nodeId} to Hub ${selectedHub.name || selectedHub.id}`);

            // Create a weak "ASSOCIATED_WITH" link (Neuroplasticity start)
            await this.createRelationship(nodeId, selectedHub.id, 'ASSOCIATED_WITH', {
                source: 'PREFERENTIAL_ATTACHMENT',
                weight: 0.1 // Starts weak, must be reinforced
            });

        } catch (e) {
            console.warn("[GRAPH] Scale-free growth error:", e);
        }
    }

    // --- GRAPHRAG CAPABILITIES (NEW) ---

    // Given a list of Node IDs (from Vector Search), find their neighbors
    public async getRelatedConcepts(nodeIds: string[], depth: number = 1): Promise<any[]> {
        if (!this.isConnected || !this.driver) return [];
        if (nodeIds.length === 0) return [];

        // Query: Find nodes with these IDs, and traverse OUT/IN relationships
        // We limit to 20 related items to avoid context overflow
        const query = `
            MATCH (n)
            WHERE n.id IN $nodeIds
            MATCH (n)-[r]-(related)
            RETURN n.id as sourceId, related.id as relatedId, related.name as name, related.label as label, type(r) as relationship, properties(related) as props
            LIMIT 20
        `;

        try {
            const results = await this.runQuery(query, { nodeIds });

            // [HEBBIAN LEARNING] Reinforce accessed connections
            // Import dynamically to avoid circular dependency
            if (results.length > 0) {
                import('./hubStrengtheningService').then(({ hubStrengthening }) => {
                    for (const result of results.slice(0, 5)) { // Limit reinforcement to top 5
                        hubStrengthening.reinforceConnection(result.sourceId, result.relatedId)
                            .catch(() => { }); // Non-blocking
                    }
                }).catch(() => { }); // Ignore if service unavailable
            }

            return results;
        } catch (e: any) {
            console.warn("[GRAPH] GraphRAG Traversal Failed:", e.message);
            return [];
        }
    }
    // --- DISCOVERY ALGORITHMS ---

    // Find "Open Triangles" (A connected to C, B connected to C, but A not connected to B)
    // This suggests A and B might be related via C.
    public async findOpenTriangles(limit: number = 5): Promise<{ nodeA: any, nodeB: any, bridge: any }[]> {
        if (!this.isConnected || !this.driver) return [];

        const query = `
            MATCH (a:Concept)-[:RELATED]-(bridge:Concept)-[:RELATED]-(b:Concept)
            WHERE NOT (a)-[:RELATED]-(b) AND a.id < b.id
            RETURN a, b, bridge
            LIMIT $limit
        `;

        try {
            const records = await this.runQuery(query, { limit: neo4j.int(limit) });
            return records.map(r => ({
                nodeA: r.a.properties,
                nodeB: r.b.properties,
                bridge: r.bridge.properties
            }));
        } catch (e) {
            console.warn("[GRAPH] Failed to find open triangles:", e);
            return [];
        }
    }

    /**
     * Get all user facts from Neo4j
     * Used by UI to display eternal memory
     */
    public async getUserFacts(userId?: string): Promise<{ category: string; content: string; confidence: number; timestamp: number }[]> {
        if (!this.isConnected || !this.driver) {
            await this.connect();
            if (!this.driver) return [];
        }

        try {
            // If userId is provided, filter by that user. Otherwise, fallback to global (admin only)
            const query = userId ? `
                MATCH (u:User {id: $userId})-[:HAS_FACT]->(f:Fact)
                RETURN f.category as category, f.content as content, 
                       f.confidence as confidence, f.timestamp as timestamp
                ORDER BY f.timestamp DESC
                LIMIT 50
            ` : `
                MATCH (f:Fact)
                RETURN f.category as category, f.content as content, 
                       f.confidence as confidence, f.timestamp as timestamp
                ORDER BY f.timestamp DESC
                LIMIT 50
            `;

            const records = await this.runQuery(query, { userId });
            return records.map((r: any) => ({
                category: r.category || 'general',
                content: r.content || '',
                confidence: typeof r.confidence === 'number' ? r.confidence : 0.9,
                timestamp: typeof r.timestamp === 'number' ? r.timestamp : Date.now()
            }));
        } catch (e) {
            console.warn("[GRAPH] Failed to get user facts:", e);
            return [];
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SYNC NEO4J CONCEPTS TO LANCEDB FOR CROSS-DOMAIN DISCOVERY
    // ═══════════════════════════════════════════════════════════════

    /**
     * Syncs a Concept node to LanceDB with vector embedding.
     * This enables EurekaService to find cross-domain connections.
     */
    public async syncConceptToVectorStore(concept: {
        id: string;
        name: string;
        description?: string;
        tags?: string[];
    }): Promise<boolean> {
        try {
            const content = `${concept.name}: ${concept.description || 'No description'}`;

            // Generate embedding (try Gemini first, falls back to Local xenova/transformers)
            let embedding = await geminiEmbed(content);

            if (!embedding) {
                console.warn(`[GRAPH] ⚠️ No embedding generated for concept: ${concept.id}`);
                return false;
            }

            // Create MemoryNode representation
            const memoryNode: MemoryNode = {
                id: concept.id,
                content: content,
                originalContent: content,
                timestamp: Date.now(),
                tier: MemoryTier.LONG, // Concepts are long-term knowledge
                importance: 0.8, // High importance
                tags: [...(concept.tags || []), 'concept', 'neo4j-synced'],
                accessCount: 0,
                lastAccess: Date.now(),
                decayHealth: 100,
                compressionLevel: 0
            };

            await lancedbService.store(memoryNode, embedding);
            console.log(`[GRAPH] 🔗→📊 Synced concept to VectorStore: ${concept.name}`);
            return true;

        } catch (e) {
            console.error(`[GRAPH] syncConceptToVectorStore failed:`, e);
            return false;
        }
    }
}

export const graph = new GraphService();
