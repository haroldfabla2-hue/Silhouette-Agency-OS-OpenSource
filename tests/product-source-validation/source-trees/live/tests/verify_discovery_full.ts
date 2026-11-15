
import { neuroCognitive } from '../services/neuroCognitiveService';

async function verifyDiscovery() {
    console.log("🔍 Verifying NeuroCognitive Discovery Cycle...");

    try {
        // 1. Trigger Discovery
        // We target 'orchestrator' node if it exists in graph, or random.
        // For this test, we assume connection might fail if Python isn't up, 
        // code handles it gracefully.

        console.log("1. Seeding Test Concept...");
        // Ensure graph connection
        await import('../services/graphService').then(m => m.graph.connect());
        const { graph } = await import('../services/graphService');

        // Create an "Open Triangle" scenario to test Common Neighbors
        // Use unique names to avoid "name IS UNIQUE" constraint collisions if re-running
        await graph.runQuery(`
            MERGE (a:Concept {id: 'verify_seed_A'}) 
            ON CREATE SET a.name = 'Test AI Concept', a.description = 'General AI field for testing.'
            ON MATCH SET a.lastSeen = timestamp()

            MERGE (b:Concept {id: 'verify_seed_B'}) 
            ON CREATE SET b.name = 'Test Computing Concept', b.description = 'Calculation and logic for testing.'

            MERGE (c:Concept {id: 'verify_seed_C'}) 
            ON CREATE SET c.name = 'Test Neural Networks Concept', c.description = 'Brain-inspired algorithms for testing.'
            
            MERGE (a)-[:RELATED_TO]->(b)
            MERGE (c)-[:RELATED_TO]->(b)
        `);

        console.log("2. Triggering Discovery Cycle on Node A...");
        await neuroCognitive.triggerDiscoveryCycle('verify_seed_A');

        console.log("✅ Discovery Cycle Triggered (Check logs for 'intuition' or connectivity warnings).");

    } catch (error) {
        console.error("❌ Discovery Cycle Crashed:", error);
        process.exit(1);
    }
}

verifyDiscovery();
