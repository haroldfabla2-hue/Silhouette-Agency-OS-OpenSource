
import { DEFAULT_API_CONFIG } from '../constants';

async function diagnose() {
    console.log("🏥 STARTING MEDIA CORTEX DIAGNOSTIC 🏥");
    console.log("========================================");

    // 1. CHECK LOCAL ENV
    console.log("\n1. CHECKING LOCAL ENVIRONMENT (.env.local)");
    const requiredKeys = [
        'OPENAI_API_KEY',
        'REPLICATE_API_TOKEN',
        'ELEVENLABS_API_KEY',
        'IMAGINE_ART_KEY',
        'UNSPLASH_ACCESS_KEY'
    ];

    let missingLocal = false;
    requiredKeys.forEach(key => {
        if (process.env[key]) {
            console.log(`✅ ${key}: FOUND (${process.env[key]?.substring(0, 8)}...)`);
        } else {
            console.error(`❌ ${key}: MISSING`);
            missingLocal = true;
        }
    });

    if (missingLocal) {
        console.warn("⚠️  Some keys are missing from .env.local. This might be intentional if you are using the UI to save them.");
    }

    // 2. CHECK RUNNING SERVER CONFIG
    console.log("\n2. CHECKING RUNNING SERVER STATE");
    try {
        const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/system/config`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const config: any = await res.json();
        console.log("✅ Server Connection: OK");

        const mediaConfig = config.mediaConfig || {};
        const serverKeys = {
            'OpenAI': mediaConfig.openaiKey,
            'Replicate': mediaConfig.replicateKey,
            'ElevenLabs': mediaConfig.elevenLabsKey,
            'ImagineArt': mediaConfig.imagineArtKey
        };

        Object.entries(serverKeys).forEach(([name, key]) => {
            if (key) {
                console.log(`✅ Server has ${name} Key: YES (${key.substring(0, 8)}...)`);
            } else {
                console.error(`❌ Server has ${name} Key: NO`);
            }
        });

        // 3. TEST ENDPOINT (Optimize Search)
        console.log("\n3. TESTING ENDPOINT: /v1/media/optimize-search");
        const testPrompt = "A futuristic city with neon lights";

        // We need the system API key for this
        const systemKey = config.systemApiKey || process.env.GEMINI_API_KEY || DEFAULT_API_CONFIG.apiKey;

        if (!systemKey) {
            console.error("❌ Cannot test endpoint: Missing System API Key (Gemini) for Authorization.");
        } else {
            const authHeader = `Bearer ${systemKey}`; // The server expects the Gemini Key or the default one? 
            // Wait, server/index.ts validateApiKey checks for 'Bearer sk-silhouette-' OR the system key?
            // Actually validateApiKey checks: startsWith('Bearer sk-silhouette-')
            // But stockService uses DEFAULT_API_CONFIG.apiKey which is 'sk-silhouette-default'

            const testAuth = `Bearer ${DEFAULT_API_CONFIG.apiKey}`;

            const searchRes = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/media/optimize-search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': testAuth
                },
                body: JSON.stringify({ prompt: testPrompt })
            });

            if (searchRes.ok) {
                const data: any = await searchRes.json();
                console.log("✅ Endpoint Test: SUCCESS");
                console.log(`   Input: "${testPrompt}"`);
                console.log(`   Output: "${data.keywords}"`);
            } else {
                console.error(`❌ Endpoint Test: FAILED (${searchRes.status} ${searchRes.statusText})`);
                const err = await searchRes.text();
                console.error(`   Error: ${err}`);
            }
        }

    } catch (e: any) {
        console.error("❌ Server Check Failed:", e.message);
        console.error("   Is the server running? (npm run server)");
    }

    console.log("\n========================================");
    console.log("🏥 DIAGNOSTIC COMPLETE 🏥");
}

diagnose();
