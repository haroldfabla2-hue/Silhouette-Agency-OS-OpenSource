
import { geminiService, configureGenAI } from '../services/geminiService';
import { IntrospectionLayer } from '../types';
import fs from 'fs';
import path from 'path';

// Manual .env parser to avoid 'dotenv' dependency
function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            const fileContent = fs.readFileSync(envPath, 'utf8');
            fileContent.split(/\r?\n/).forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    let val = match[2].trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    process.env[match[1].trim()] = val;
                }
            });
        }
    } catch (e) {
        console.warn("⚠️ Could not load .env.local");
    }
}
loadEnv();

async function runFullStackTest() {
    console.log("🧪 --- STARTING FULL STACK MODEL TEST ---");

    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ CRITICAL: No GEMINI_API_KEY found.");
        process.exit(1);
    }

    // Configure Service with loaded key because import happened before loadEnv
    configureGenAI(process.env.GEMINI_API_KEY);

    // 1. Direct Model Test
    try {
        console.log("\n📡 TEST 1: Direct 'gemini-2.5-flash' Access...");
        const response = await geminiService.generateText("Ping");
        if (response.includes("Error")) throw new Error(response);
        console.log(`✅ Direct Access OK: "${response.trim()}"`);
    } catch (error: any) {
        console.error(`❌ TEST 1 FAILED: ${error.message}`);
        return; // Stop if basic access fails
    }

    // 2. CFO Integration Test (Simple Task -> Should trigger Flash)
    try {
        console.log("\n💰 TEST 2: CFO Negotiation & Agent flow (Simple Task)...");
        const agentResp = await geminiService.generateAgentResponse(
            "TestAgent",
            "Tester",
            "TEST",
            "Say 'Hello World'", // Simple task
            null,
            IntrospectionLayer.SHALLOW,
            undefined
        );

        console.log(`✅ Agent Response: "${agentResp.output}"`);
        console.log(`🧠 Thoughts: ${agentResp.thoughts.length}`);

        if (agentResp.output.includes("Hello World")) {
            console.log("✅ CFO selected correct model (likely 2.5 Flash) and it worked.");
        }

    } catch (error: any) {
        console.error(`❌ TEST 2 FAILED: ${error.message}`);
        if (error.message.includes("404")) {
            console.error("⚠️  CFO likely returned a bad model string (e.g. 1.5-flash).");
        }
    }
}

runFullStackTest();
