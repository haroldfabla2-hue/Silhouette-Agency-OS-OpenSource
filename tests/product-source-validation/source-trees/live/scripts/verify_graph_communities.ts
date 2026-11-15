import { graph } from '../services/graphService';

async function verifyCommunities() {
    console.log("🕵️ Verifying Graph Communities...");
    try {
        await graph.connect();

        // Count Communities
        const countResult = await graph.runQuery('MATCH (c:Community) RETURN count(c) as total');
        const total = countResult[0].total; // Neo4j int

        console.log(`\n📊 Total Communities Found: ${total}`);

        if (Number(total) > 0) {
            // Show Samples
            const samples = await graph.runQuery('MATCH (c:Community) RETURN c.name as name, c.summary as summary, c.level as level LIMIT 5');
            console.log("\n🔎 Sample Communities:");
            samples.forEach((record: any) => {
                console.log(`   - [L${record.level}] ${record.name}: ${record.summary}`);
            });
            console.log("\n✅ SUCCESS: The Heuristic Fallback worked.");
        } else {
            console.log("\n❌ FAILURE: No communities found. The fallback did not execute correctly.");
        }

        await graph.close();
        process.exit(0);
    } catch (error) {
        console.error("❌ Error verifying graph:", error);
        process.exit(1);
    }
}

verifyCommunities();
