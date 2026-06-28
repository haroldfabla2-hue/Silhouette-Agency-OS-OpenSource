
import { actionExecutor } from '../services/actionExecutor';
import { ActionType } from '../types';
import fs from 'fs/promises';

async function verifyRealWan() {
    console.log("🎬 Starting REAL Wan Video Generation Verification...");

    // Ensure data directory exists
    await fs.mkdir('data/queues', { recursive: true });

    // Payload: Text-to-Video logic first for speed
    // If you want Image-to-Video, provide a valid path to an image here:
    // const imagePath = path.join(process.cwd(), 'sandbox', 'test_image.png');

    console.log("🚀 Triggering GENERATE_VIDEO Action (Text-to-Video for speed)...");
    console.log("   Prompt: 'A futuristic cyberpunk city with neon lights, cinematic 4k'");

    const result = await actionExecutor.execute({
        id: `test-video-${Date.now()}`,
        agentId: 'tester',
        type: ActionType.GENERATE_VIDEO,
        payload: {
            content: "A futuristic cyberpunk city with neon lights, cinematic 4k",
            // path: imagePath // Uncomment if testing I2V
        },
        status: 'PENDING',
        timestamp: Date.now(),
        requiresApproval: false
    });

    if (result.success) {
        console.log("✅ Video Generation Successful!");
        console.log("   Output Path:", result.data.path);
    } else {
        console.error("❌ Video Generation Failed:", result.error);
    }

    // Verify Resource Manager State
    // (Should be back to LLM)
    // We can't access private 'currentOwner' easily but the logs will show it.
}

verifyRealWan().catch(console.error);
