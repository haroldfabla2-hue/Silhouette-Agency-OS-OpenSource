import { minimaxService } from '../../services/minimaxService';

async function main() {
    console.log('[DEBUG] Testing Minimax Vision Integration...');
    try {
        // A minimal 1x1 transparent PNG base64 representation just to test the API acceptance
        const dummyBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

        const prompt = "What is in this image? Provide a very brief 1 sentence description.";
        console.log(`[DEBUG] Prompt: "${prompt}"`);

        const description = await minimaxService.analyzeImage(prompt, dummyBase64);

        if (description) {
            console.log(`[DEBUG] ✅ SUCCESS! Vision Response:`);
            console.log(description);
        } else {
            console.error('[DEBUG] ❌ FAILED. Response was empty.');
        }
    } catch (e: any) {
        console.error('[DEBUG] ❌ Exception caught:', e.message);
    }
}

main();
