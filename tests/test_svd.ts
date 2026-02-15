
import { ComfyService } from '../services/comfyService';
import path from 'path';

async function testSVD() {
    const service = new ComfyService();

    // Check Availability
    console.log("Checking ComfyUI Status...");
    const isOnline = await service.isAvailable();
    if (!isOnline) {
        console.error("❌ ComfyUI is OFFLINE. Please start it first.");
        return;
    }
    console.log("✅ ComfyUI is Online.");

    // SVD Requires an Input Image. We will use a sample.
    // Ensure you have a file named 'test_input.png' in the root or adjust this path
    const inputImage = path.resolve(process.cwd(), 'uploaded_image_1766016622889.png');

    console.log(`🚀 Starting SVD Image-to-Video Test with: ${inputImage}`);

    try {
        const videoPath = await service.generateVideo(inputImage, 'SVD');
        console.log(`\n----------------------------------------`);
        console.log(`🎉 SUCCESS! Video Generated from Image.`);
        console.log(`📂 Output: ${videoPath}`);
        console.log(`----------------------------------------`);
    } catch (error: any) {
        console.error("\n❌ TEST FAILED:", error.message);
        if (error.response) {
            console.error("API Error Details:", JSON.stringify(error.response.data, null, 2));
        }
    }
}

testSVD();
