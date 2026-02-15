
import { comfyService } from '../services/comfyService';

async function testVideoGen() {
    console.log("🎬 S T A R T I N G   V I D E O   T E S T");
    console.log("----------------------------------------");

    // 1. Check Connectivity
    console.log("📡 Pinging Visual Cortex...");
    const available = await comfyService.isAvailable();
    if (!available) {
        console.error("❌ CRTICAL: ComfyUI is not reachable at http://127.0.0.1:8188");
        console.error("   Please run 'start_all.bat' or open ComfyUI manually.");
        process.exit(1);
    }
    console.log("✅ Visual Cortex Online.");

    // 2. Trigger Generation
    const prompt = "A futuristic cyberpunk city with neon rain, cinematic lighting, 4k";
    console.log(`🚀 Sending Prompt: "${prompt}"`);
    console.log("⏳ Waiting for generation (this may take 1-2 minutes on RTX 3050)...");

    try {
        const result = await comfyService.generateVideo(prompt);
        console.log("----------------------------------------");
        console.log("🎉 SUCCESS! Video generated.");
        console.log(`📂 Output: ${result}`);
        console.log("----------------------------------------");
    } catch (error: any) {
        console.error("----------------------------------------");
        console.error("💥 SYSTEM FAILURE:");
        console.error(error.message);
        console.error("----------------------------------------");
        if (error.message.includes("node_errors")) {
            console.log("💡 TIP: If you see 'node_errors', your ComfyUI workflow might be missing nodes.");
            console.log("   Check the server console window for details.");
        }
    }
}

testVideoGen();
