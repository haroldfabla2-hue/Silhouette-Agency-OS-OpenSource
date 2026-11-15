
import { comfyService } from '../services/comfyService';

async function testAnimateDiff() {
    console.log("🎨 S T A R T I N G   A N I M A T E D I F F   T E S T");
    console.log("---------------------------------------------------");

    // 1. Check Connectivity
    const available = await comfyService.isAvailable();
    if (!available) {
        console.error("❌ CRTICAL: ComfyUI is offline.");
        process.exit(1);
    }

    // 2. Trigger with explicitly 'ANIMATEDIFF' engine
    const prompt = "1girl, solo, anime style, cybernetic interface, glowing eyes, 4k, masterpiece, best quality";
    console.log(`🚀 Engine: ANIMATEDIFF (Lightning)`);
    console.log(`📝 Prompt: "${prompt}"`);

    try {
        const result = await comfyService.generateVideo(prompt, 'ANIMATEDIFF');
        console.log("----------------------------------------");
        console.log("🎉 SUCCESS! Anime generated.");
        console.log(`📂 Output: ${result}`);
        console.log("----------------------------------------");
    } catch (error: any) {
        console.error("💥 FAILED:");
        console.error(error.message);
        if (error.message.includes("Node Errors")) {
            console.log("💡 CHECK: Did you download 'dreamshaper_8.safetensors' and 'animatediff_lightning...'?");
        }
    }
}

testAnimateDiff();
