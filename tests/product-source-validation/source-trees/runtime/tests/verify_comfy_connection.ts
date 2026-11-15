
import { comfyService } from '../services/comfyService';
import { resourceManager } from '../services/resourceManager';

async function verifyComfyConnection() {
    console.log("🔌 Testing Link to Visual Cortex (ComfyUI)...");

    try {
        const isOnline = await comfyService.isAvailable();

        if (isOnline) {
            console.log("✅ Visual Cortex is ONLINE (http://127.0.0.1:8188).");
            console.log("   - GPU: Detected by ComfyUI (per user logs).");
            console.log("   - API: Reachable via ComfyService.");

            // Note: We don't queue a real prompt yet because we need the Wan workflow JSON.
            // That will be the next step.
        } else {
            console.error("❌ Visual Cortex is OFFLINE. Please start 'run_nvidia_gpu.bat'.");
        }

    } catch (error: any) {
        console.error("💥 Connection Error:", error.message);
    }
}

verifyComfyConnection();
