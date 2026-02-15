import { orchestrator } from '../services/orchestrator';
import { agentStreamer } from '../services/agentStream';
import { WorkflowStage, IntrospectionLayer } from '../types';
import { configureGenAI, geminiService } from '../services/geminiService';
import { DEFAULT_API_CONFIG } from '../constants';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

// --- MANUAL ENV LOADER ---
// Since we run with 'npx tsx' and dotenv is not installed, we load .env.local manually.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
    console.log("✅ Loaded .env.local");
}

// Use Real API Key for End-to-End Verification
const apiKey = process.env.VITE_API_KEY || DEFAULT_API_CONFIG.apiKey || "TEST_KEY";
configureGenAI(apiKey);
console.log(`[VERIFY] Key Configured: ${apiKey ? "YES (****)" : "NO"}`);


// Robust verification helper: Waits for specific agent completion
function waitForAppointedAgent(agentId: string, timeoutMs: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for agent ${agentId}`));
        }, timeoutMs);

        let unsubscribe: (() => void) | undefined;

        const listener = (event: any) => {
            const payload = event.payload;

            if (payload && payload.agentId === agentId) {
                clearTimeout(timer);
                if (unsubscribe) unsubscribe();
                resolve(payload.result);
            }
        };
        unsubscribe = systemBus.subscribe(SystemProtocol.TASK_COMPLETION, listener);
    });
}

async function runDistributedVerification() {
    console.log("🧪 Verifying Distributed Agent Orchestration (Robust Event-Driven Mode)...");

    // 1. Setup Listeners BEFORE activation to catch fast agents
    console.log("📡 Establishing Neural Monitors for: strat-01, core-01...");
    const stratPromise = waitForAppointedAgent('strat-01');
    const corePromise = waitForAppointedAgent('core-01');

    // 2. Simulate Stage Activation (PLANNING)
    console.log("\n--- TRIGGER: PLANNING STAGE ---");

    // Note: Orchestrator has an internal stutter/delay mechanism
    await orchestrator.activateSquadsForStage(WorkflowStage.PLANNING, {
        project: "Project_Silhouette",
        goal: "Domination"
    });

    console.log("⏳ Squads activated. Monitoring for results (Timeout: 30s)...");

    try {
        // 3. Wait for actual completion of tasks
        const [stratResult, coreResult] = await Promise.all([stratPromise, corePromise]);

        console.log("\n--- VERIFICATION: RESULTS RECEIVED ---");
        console.log(`✅ Strategos_X (strat-01): Mission Complete (${stratResult.length} chars output)`);
        console.log(`✅ Orchestrator_Prime (core-01): Mission Complete (${coreResult.length} chars output)`);

        // Check Unrelated Agent (e.g. mkt-lead)
        const mktActive = agentStreamer.isStreaming('mkt-lead');
        console.log(`Creative_Director (mkt-lead): ${!mktActive ? "✅ IDLE" : "❌ ACTIVE (Unexpected)"}`);

        if (!mktActive) {
            console.log("\n✅ SUCCESS: Distributed Orchestration Logic is Valid & Robust.");
            process.exit(0);
        } else {
            console.error("\n❌ FAILURE: Unexpected agents are active.");
            process.exit(1);
        }

    } catch (error) {
        console.error("\n❌ FAILURE: Validation Timeout or Error:", error);
        process.exit(1);
    }
}

runDistributedVerification();
