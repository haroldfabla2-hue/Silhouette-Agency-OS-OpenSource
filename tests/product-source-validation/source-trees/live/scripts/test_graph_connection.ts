import { graph } from '../services/graphService';

async function testConnection() {
    console.log("🧪 Testing Neo4j Connection...");
    try {
        await graph.connect();

        // Create a test node
        console.log("📝 Creating Test Node...");
        await graph.createNode('TestNode', {
            id: 'test-001',
            message: 'Hello GraphRAG!',
            timestamp: Date.now()
        });

        // Query it back
        console.log("🔍 Querying Test Node...");
        const result = await graph.runQuery(`MATCH (n:TestNode {id: 'test-001'}) RETURN n`);

        if (result.length > 0) {
            console.log("✅ SUCCESS: Found Node:", result[0]);
        } else {
            console.error("❌ FAILURE: Node not found.");
        }

        await graph.close();
        process.exit(0);
    } catch (error) {
        console.error("❌ CRITICAL FAILURE:", error);
        process.exit(1);
    }
}

testConnection();
