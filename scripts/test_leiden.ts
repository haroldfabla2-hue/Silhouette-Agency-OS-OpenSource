import { leiden } from '../services/leidenService';
import { graph } from '../services/graphService';
import { configureGenAI } from '../services/geminiService';
import fs from 'fs';
import path from 'path';

// Load Environment Variables manually for standalone script
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    const match = envConfig.match(/GEMINI_API_KEY=(.*)/);
    if (match && match[1]) {
        const apiKey = match[1].trim();
        configureGenAI(apiKey);
        console.log("🔑 API Key loaded from .env.local");
    }
} else {
    console.warn("⚠️ .env.local not found. Ensure GEMINI_API_KEY is set.");
}

async function testLeiden() {
    console.log("🧪 Testing Semantic Leiden Algorithm...");
    try {
        await leiden.runCommunityDetection();

        // Verify results
        await graph.connect();
        const communities = await graph.runQuery(`MATCH (c:Community) RETURN c`);

        if (communities.length > 0) {
            console.log(`✅ SUCCESS: Found ${communities.length} Communities in Graph.`);
            communities.forEach((c: any) => {
                console.log(`   - [${c.c.properties.name}]: ${c.c.properties.summary}`);
            });
        } else {
            console.error("❌ FAILURE: No communities found.");
        }

        await graph.close();
        process.exit(0);
    } catch (error) {
        console.error("❌ CRITICAL FAILURE:", error);
        process.exit(1);
    }
}

testLeiden();
