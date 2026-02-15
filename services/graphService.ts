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
    private isConnected: boolean = false;
    private isRegistered: boolean = false;
    private connectionTimeout: NodeJS.Timeout | null = null;
    private readonly TIMEOUT_MS = 5 * 60 * 1000; // 5 Minutes

    constructor() {
        // Lazy initialization - connection managed by NervousSystem
    }

    /**
     * Simple connection - no retry logic here.
     * All resilience is handled by ConnectionNervousSystem.
     */
    public async connect(): Promise<boolean> {
        if (this.isConnected && this.driver) {
            this.resetConnectionTimeout(); // Keep alive on manual connect
            return true;
        }

        const config = configLoader.getConfig();
        if (config.modules.graph === false) {
            console.log("[GRAPH] 🚫 Graph module disabled in config (Lite Mode). Skipping connection.");
            return false;
        }

        try {
            console.log("[GRAPH] 🔗 Connecting to Neo4j...");
            this.driver = neo4j.driver(
                process.env.NEO4J_URI || 'bolt://127.0.0.1:7787',
                neo4j.auth.basic(
                    process.env.NEO4J_USER || 'neo4j',
                    process.env.NEO4J_PASSWORD || 'silhouette_graph_2035'
                ),
                {
                    maxConnectionLifetime: 30 * 60 * 1000,
                    maxConnectionPoolSize: 50,
                    connectionAcquisitionTimeout: 5000
                }
            );

            await this.driver.verifyConnectivity();
            this.isConnected = true;
            console.log("[GRAPH] ✅ Connected to Neo4j.");

            this.resetConnectionTimeout();
            this.registerWithNervousSystem();

            // Initialize schema in background
            setImmediate(() => this.initializeSchema().catch(() => { }));

            return true;

        } catch (error: any) {
            console.error("[GRAPH] ❌ Connection failed:", error.message);
            this.isConnected = false;
            this.driver = null;
            return false;
        }
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
        return this.isConnected;
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
        this.isConnected = false;
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
        if (!this.isConnected || !this.driver) {
            await this.connect();
            if (!this.driver) throw new Error("Graph Database not available.");
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
                this.isConnected = false;
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

    public async close() {
        if (this.driver) {
            await this.driver.close();
            this.isConnected = false;
            console.log("[GRAPH] 🔌 Disconnected.");
        }
    }

    // --- HELPER METHODS ---

    public async createNode(label: string, properties: any, mergeKey: string = 'id') {
        // Ensure ID exists
        if (!properties.id) properties.id = crypto.randomUUID();

        // Dynamic MERGE based on the provided key (id, name, etc.)
        const query = `
            MERGE (n:${label} {${mergeKey}: $mergeVal})
            SET n += $props, n.lastUpdated = timestamp()
            RETURN n
        `;

        try {
            return await this.runQuery(query, {
                mergeVal: properties[mergeKey],
                props: properties
            });
        } catch (error: any) {
            console.error(`[GRAPH] Node creation failed for ${label}:`, error);
            throw error;
        }
    }


    public async createRelationship(fromId: string, toId: string, type: string, properties: any = {}) {
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
        return this.runQuery(query, { limit });
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
    public async getUserFacts(): Promise<{ category: string; content: string; confidence: number; timestamp: number }[]> {
        if (!this.isConnected || !this.driver) {
            await this.connect();
            if (!this.driver) return [];
        }

        try {
            const query = `
                MATCH (f:Fact)
                RETURN f.category as category, f.content as content, 
                       f.confidence as confidence, f.timestamp as timestamp
                ORDER BY f.timestamp DESC
                LIMIT 50
            `;

            const records = await this.runQuery(query, {});
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

            // Generate embedding (try Gemini first, fallback handled internally)
            let embedding = await geminiEmbed(content);

            // Fallback to direct Ollama HTTP call if Gemini fails
            if (!embedding) {
                try {
                    console.log("[GRAPH] 🔄 Trying Ollama embeddings via HTTP...");
                    const response = await fetch('http://localhost:11434/api/embeddings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: 'nomic-embed-text',
                            prompt: content
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.embedding && Array.isArray(data.embedding)) {
                            embedding = data.embedding;
                            console.log(`[GRAPH] ✅ Ollama embedding generated (${embedding.length} dims)`);
                        }
                    } else {
                        console.warn("[GRAPH] Ollama embedding request failed:", response.status);
                    }
                } catch (ollamaError: any) {
                    console.warn("[GRAPH] Ollama embedding fallback failed:", ollamaError.message);
                }
            }

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
