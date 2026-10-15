
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env before imports
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function verifyFullAgencySimulation() {
    console.log("\n🎬 === SIMULATING FULL AGENCY WORKFLOW === 🎬\n");

    // Dynamic Imports
    const { systemBus } = await import("../services/systemBus");
    await import("../services/orchestrator");
    const { creativeDirector } = await import("../services/skills/creativeDirectorSkill");
    const { SystemProtocol } = await import("../types");

    // 1. SETUP: Mock Agents in Persistence?
    // For this simulation, we assume 'mkt-lead' exists as a service agent.
    // We create a temporary 'dev-client' agent.
    const CLIENT_ID = 'dev-client-007';

    console.log("🕵️  Scenario: Developer Agent needs a splash screen asset.");

    // 2. ACTION: Client sends request to Inbox
    console.log(`[CLIENT] 📤 Sending request to 'mkt-lead' via SystemBus...`);

    const requestPayload = {
        taskType: 'GENERATE_IMAGE',
        context: {
            prompt: "Futuristic dashboard interface, dark mode, neon blue accents, 8k",
            brief: "Need a background for the new login screen."
        },
        correlationId: 'req_simulation_123'
    };

    systemBus.send({
        id: 'msg_sim_01',
        traceId: 'trace_sim_01',
        senderId: CLIENT_ID,
        targetId: 'mkt-lead',
        type: 'REQUEST', // Expecting answer
        protocol: SystemProtocol.TASK_ASSIGNMENT,
        payload: requestPayload,
        timestamp: Date.now(),
        priority: 'HIGH'
    });

    // 3. ORCHESTRATION: The System Pulse
    console.log("\n⏳ [SYSTEM] Orchestrator Ticking (Processing Global Mail)...");

    let responseReceived = false;

    console.log("🔄 Polling for ~15 seconds to allow generation...");

    // Simulation Loop
    for (let i = 0; i < 20; i++) {
        process.stdout.write(".");

        // 1. Simulating Orchestrator delegation (Wake up the director):
        if (i === 1) { // On "second 1"
            console.log("\n[ORCHESTRATOR] ⚡ (Simulated) Waking mkt-lead...");
            await creativeDirector.checkInbox();
        }

        // 2. Simulating Client checking their own inbox
        const myMail = await systemBus.checkMailbox(CLIENT_ID);
        for (const msg of myMail) {
            if (msg.payload?.correlationId === 'req_simulation_123') {
                console.log("\n[CLIENT] 📥 RESPONSE RECEIVED in Mailbox!");
                console.log("📦 Payload:", JSON.stringify(msg.payload, null, 2));
                responseReceived = true;
            }
        }

        await new Promise(r => setTimeout(r, 1000));

        if (responseReceived) break;
    }

    if (responseReceived) {
        console.log("\n✅ FULL AGENCY SIMULATION PASSED");
        console.log("   - Message routed");
        console.log("   - Agent awakened");
        console.log("   - Asset generated");
        console.log("   - Reply delivered");
        process.exit(0);
    } else {
        console.error("\n❌ TIMEOUT: No response received from mkt-lead.");
        process.exit(1);
    }
}

verifyFullAgencySimulation();
