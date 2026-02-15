
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local immediately
const envPath = path.resolve(process.cwd(), '.env.local');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.error("⚠️ Failed to load .env.local:", result.error);
} else {
    console.log("✅ .env.local loaded successfully.");
}

async function verifyMediaStack() {
    // Dynamic import to ensure env vars are available before service instantiation
    const { imageFactory } = await import("../services/media/imageFactory");

    console.log("🎬 Verifying Agency Media Stack...");

    // Test 1: Stock Photo (Unsplash)
    console.log("\n1. Testing Stock Service (Unsplash)...");
    const stockAsset = await imageFactory.createAsset({
        prompt: "Futuristic city skyline at sunset",
        style: 'STOCK_PHOTO',
        aspectRatio: '16:9'
    });
    if (stockAsset) {
        console.log(`✅ Stock Success: ${stockAsset.url}`);
        console.log(`   Provider: ${stockAsset.provider}`);
    } else {
        console.error("❌ Stock Failed.");
    }

    // Test 2: Nano Banana (Replicate) -> Using a safe prompt
    console.log("\n2. Testing Nano Banana (Replicate)...");
    const genAsset = await imageFactory.createAsset({
        prompt: "A futuristic cyborg sleek design, cinematic lighting, 8k",
        style: 'PHOTOREALISTIC',
        aspectRatio: '16:9'
    });

    if (genAsset) {
        console.log(`✅ Gen Success: ${genAsset.url}`);
        console.log(`   Provider: ${genAsset.provider}`);
    } else {
        console.error("❌ Gen Failed.");
    }
}

verifyMediaStack();
