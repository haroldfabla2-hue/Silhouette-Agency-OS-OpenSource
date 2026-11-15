
import { toolHandler } from '../services/tools/toolHandler';
import { GenerateImageArgs } from '../services/tools/definitions';
import { imageFactory } from '../services/media/imageFactory';

// Mock ImageFactory
const originalCreateAsset = imageFactory.createAsset;
imageFactory.createAsset = async (req) => {
    console.log("[MOCK] ImageFactory.createAsset called with:", req);
    return {
        id: "mock-asset-id",
        url: "https://mock-url.com/image.png",
        provider: "MOCK_PROVIDER",
        prompt: req.prompt,
        metadata: {},
        timestamp: Date.now()
    };
};

async function testGenerateImage() {
    console.log("--- TEST: generate_image Tool ---");

    const args: GenerateImageArgs = {
        prompt: "A futuristic skyline at sunset",
        style: "PHOTOREALISTIC",
        aspectRatio: "16:9"
    };

    const result = await toolHandler.handleFunctionCall('generate_image', args);
    console.log("Result:", result);

    if (result.status === 'success' && result.url === "https://mock-url.com/image.png") {
        console.log("✅ TEST PASSED");
    } else {
        console.error("❌ TEST FAILED");
    }

    // Restore
    imageFactory.createAsset = originalCreateAsset;
}

testGenerateImage().catch(console.error);
