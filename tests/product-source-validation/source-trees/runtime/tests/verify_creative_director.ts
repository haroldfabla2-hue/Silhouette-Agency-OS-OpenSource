import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env before imports
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Dynamic imports to ensure env is loaded first
async function runTest() {
    console.log("🎬 Verifying Creative Director Skill...");

    try {
        const { creativeDirector } = await import('../services/skills/creativeDirectorSkill');
        const { systemBus } = await import('../services/systemBus');
        const { SystemProtocol } = await import('../types');

        console.log("📨 Sending Async Message to Director's Inbox...");

        // 1. Simulate an Agent (e.g., 'Core', or 'User') sending a request to 'mkt-lead'
        const brief = "Cyberpunk Detective in Neon Rain";

        // We use the Orchestrator's Protocol Style: TASK_ASSIGNMENT
        systemBus.send({
            id: 'msg_test_01',
            traceId: 'trace_01',
            senderId: 'verifier_script',
            targetId: 'mkt-lead',
            type: 'REQUEST',
            protocol: SystemProtocol.TASK_ASSIGNMENT,
            payload: {
                taskType: 'GENERATE_CAMPAIGN',
                context: { brief: brief },
                correlationId: 'req_01'
            },
            timestamp: Date.now(),
            priority: 'NORMAL'
        });

        console.log("⏳ Waiting for Polling Cycle...");

        // 2. Trigger Inbox Handler Manually (simulating Orchestrator Tick)
        // We wait a mo to ensure message is in bus (MemoryAdapter is instant partialy, but good practice)
        await new Promise(r => setTimeout(r, 500));

        // Force the check
        await creativeDirector.checkInbox();

        // 3. Verify Output
        // The checkInbox should have emitted thoughts or logs. 
        // We can check if video queue has the job.

        console.log("\n🧪 Verification Logic: Checking Video Queue for job...");
        const queuePath = path.resolve(__dirname, '../data/queues/video_render_queue.json');

        if (fs.existsSync(queuePath)) {
            const queueData = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
            const job = queueData.find((j: any) => j.prompt.includes(brief));

            if (job) {
                console.log("✅ SUCCESS: Job found in queue via Async Inbox!", job.id);
                process.exit(0);
            } else {
                console.error("❌ Job NOT found. Inbox processing failed.");
                process.exit(1);
            }
        }

    } catch (error) {
        console.error("❌ Test Crashed:", error);
        process.exit(1);
    }
}

runTest();
