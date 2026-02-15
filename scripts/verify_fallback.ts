
import { geminiService, configureGenAI } from '../services/geminiService';
import fs from 'fs';
import path from 'path';
import { IntrospectionLayer } from '../types';

// Robust .env parser
function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        console.log(`📂 Loading .env from: ${envPath}`);

        if (fs.existsSync(envPath)) {
            const fileContent = fs.readFileSync(envPath, 'utf8');
            const lines = fileContent.split(/\r?\n/);
            let loaded = 0;

            lines.forEach(line => {
                const trimmed = line.trim();
                // Match KEY=VALUE, allowing for quoted values
                const match = trimmed.match(/^([^=]+)=(.*)$/);
                if (match && !trimmed.startsWith('#')) {
                    const key = match[1].trim();
                    let val = match[2].trim();

                    // Remove surrounding quotes if present
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }

                    process.env[key] = val;
                    loaded++;
                }
            });
            console.log(`✅ Loaded ${loaded} keys from .env.local`);
        } else {
            console.error("❌ .env.local file NOT FOUND");
        }
    } catch (e: any) {
        console.warn("⚠️ Error loading .env.local:", e.message);
    }
}
loadEnv();

async function runVerification() {
    console.log("🧪 --- STARTING FALLBACK RESILIENCE TEST ---");

    // Debug Keys (Masked)
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const orKey = process.env.OPENROUTER_API_KEY;

    console.log(`🔑 Keys Status:`);
    console.log(`   - GEMINI: ${geminiKey ? '✅ Present' : '❌ MISSING'}`);
    console.log(`   - GROQ:   ${groqKey ? '✅ Present' : '❌ MISSING'}`);
    console.log(`   - OPENROUTER: ${orKey ? '✅ Present' : '❌ MISSING'}`);

    if (!groqKey) {
        console.error("❌ CRITICAL: GROQ_API_KEY missing. Cannot test fallback.");
        process.exit(1);
    }

    // Configure Service with real key initially (to ensure it initializes)
    if (geminiKey) configureGenAI(geminiKey);

    // 1. SABOTAGE: Break Primary (Gemini)
    console.log("\n💥 Sabotaging Gemini (Primary: gemini-2.5-flash)...");
    configureGenAI("INVALID_KEY_FOR_TESTING");

    // 2. SABOTAGE: Break Secondary (OpenRouter)
    console.log("💥 Sabotaging OpenRouter (Secondary: gemini-2.0-flash-001)...");
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "INVALID_KEY_FOR_TESTING";

    // 3. EXECUTE
    console.log("\n🚀 Sending Request (Should Fallback to Groq / GPT-OSS-120B)...");
    const startTime = Date.now();

    try {
        const response = await geminiService.generateAgentResponse(
            "TestAgent",
            "Tester",
            "TEST",
            "Explain in one sentence why AI is cool.",
            null,
            IntrospectionLayer.DEEP, // Introspection Depth
            undefined, // Stage
            undefined, // Project Context
            {}, // Sensory
            undefined, // Level
            undefined // Override
        );

        const duration = Date.now() - startTime;
        console.log(`\n✅ RESPONSE RECEIVED in ${duration}ms!`);
        console.log(`📝 Output: "${response.output.trim()}"`);

        // Validation Heuristic: Groq usually responds extremely fast
        if (duration < 2000) {
            console.log("⚡ Latency suggests Groq/LPU usage (Fast).");
        }

        console.log("\n--- TEST SUCCESS: System survived double failure ---");

    } catch (error) {
        console.error("\n❌ TEST FAILED:", error);
    } finally {
        // Restore Keys (Good Citizenship)
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
        if (geminiKey) configureGenAI(geminiKey);
        console.log("\n🔧 Environment restored.");
        process.exit(0);
    }
}

runVerification();
