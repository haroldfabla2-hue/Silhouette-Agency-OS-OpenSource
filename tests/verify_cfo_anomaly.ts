
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local explicitly
const envLocalPath = path.resolve(__dirname, '../.env.local');
dotenv.config({ path: envLocalPath });

console.log("🔑 Environment loaded from:", envLocalPath);

// DYNAMIC IMPORTS
async function runTest() {
    const { systemBus } = await import('../services/systemBus');
    const { SystemProtocol } = await import('../types');

    // We need to initialize the Orchestrator for it to listen
    console.log("🚀 Initializing Orchestrator...");
    const { orchestrator } = await import('../services/orchestrator');

    // Wait for init
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("🧪 STARTING CFO ANOMALY TEST...");

    // Mock Listener for Remediation triggering
    systemBus.subscribe(SystemProtocol.UI_REFRESH, (event) => {
        // Orchestrator emits 'Swarm Topology Updated' or Remediation emits 'Applying Fix'
        if (event.payload.source === 'REMEDIATION') {
            console.log(`\n[✅ SUCCESS]: Remediation Squad Activated! Message: ${event.payload.message}`);
            process.exit(0);
        }
    });

    // Also listen for thoughts
    systemBus.subscribe(SystemProtocol.THOUGHT_EMISSION, (event) => {
        if (event.payload.source === 'RemediationService') {
            console.log(`[🧠 REMEDIATION THOUGHT]: ${event.payload.thoughts[0]}`);
        }
    });

    // SIMULATE ANOMALY
    const anomalyPayload = {
        agentId: 'agent_big_spender_01',
        cost: 500.00 // Massive spike
    };

    console.log(`\n💸 Emitting COST_ANOMALY event for ${anomalyPayload.agentId} ($${anomalyPayload.cost})...`);
    systemBus.emit(SystemProtocol.COST_ANOMALY, anomalyPayload, 'CFO_TEST_SCRIPT');

    // Timeout if nothing happens
    setTimeout(() => {
        console.error("\n❌ TIMEOUT: Remediation not triggered within 60s.");
        process.exit(1);
    }, 60000);
}

runTest().catch(console.error);
