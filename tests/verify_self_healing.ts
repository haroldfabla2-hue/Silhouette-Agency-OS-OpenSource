
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local explicitly
const envLocalPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envLocalPath });

console.log("🔑 Environment loaded from:", envLocalPath);
if (process.env.GEMINI_API_KEY) {
    console.log("✅ GEMINI_API_KEY found.");
} else {
    console.error("❌ GEMINI_API_KEY NOT FOUND in .env.local");
}

// DYNAMIC IMPORTS TO AVOID HOISTING ISSUES
// Services initialize top-level variables (like API keys) immediately on import.
// We must load env vars FIRST, then import the services.

async function runTest() {
    const { remediation } = await import('../services/remediationService');
    const { systemBus } = await import('../services/systemBus');
    const { SystemProtocol } = await import('../types');

    console.log("🧪 STARTING COGNITIVE SELF-HEALING TEST...");

    // Mock Listener for Self-Healing Thoughts
    systemBus.subscribe(SystemProtocol.THOUGHT_EMISSION, (event) => {
        if (event.payload.source === 'RemediationService') {
            console.log(`\n[🧠 SELF-HEAL THOUGHT]: ${event.payload.thoughts[0]}`);
        }
    });

    systemBus.subscribe(SystemProtocol.UI_REFRESH, (event) => {
        if (event.payload.source === 'REMEDIATION') {
            console.log(`\n[🛠️ FIX APPLIED]: ${event.payload.message}`);
        }
    });

    // SIMULATE COMPLEX ERROR
    // "Unknown" root cause usually triggers research.
    const mockAgentId = 'agent_chaos_01';
    const errorLog = [
        "Error: Heap limit Allocation failed - JavaScript heap out of memory",
        "at GraphService.traverse (graphService.ts:502)",
        "WARN: Recursion detected in node traversal.",
        "CRITICAL: Infinite loop in graph exploration logic."
    ];

    console.log("\n💥 TRIGGERING SIMULATED FAILURE...");
    await remediation.mobilizeSquad(mockAgentId, errorLog);

    console.log("\n✅ TEST COMPLETE. Check logs above for 'Research Complete' and 'Fix Squad Deployed'.");
    process.exit(0);
}

runTest().catch(console.error);
