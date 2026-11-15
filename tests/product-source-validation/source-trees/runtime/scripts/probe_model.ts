
import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';

// Manual .env parser to avoid 'dotenv' dependency
function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (!fs.existsSync(envPath)) {
            console.log("❌ .env.local file NOT found at:", envPath);
            return;
        }

        const fileContent = fs.readFileSync(envPath, 'utf8');
        const lines = fileContent.split(/\r?\n/); // Handle Windows CRLF

        let loadedCount = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue; // Skip empty/comments

            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx).trim();
                let val = trimmed.substring(eqIdx + 1).trim();
                // Remove quotes check
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                process.env[key] = val;
                loadedCount++;
            }
        }
        console.log(`✅ Loaded .env.local manually (${loadedCount} keys parsed)`);
    } catch (e: any) {
        console.warn("⚠️ Could not load .env.local:", e.message);
    }
}

loadEnv();

async function probe() {
    console.log("🕵️ Probing 'gemini-2.5-flash' on Official Google API...");

    // Check both common keys
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!apiKey) {
        console.error("❌ No GEMINI_API_KEY or API_KEY found in process.env");
        console.log("Keys found:", Object.keys(process.env).filter(k => k.includes('KEY') || k.includes('API')));
        return;
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [{ text: "Hello" }] }]
        });
        console.log("✅ SUCCESS! 'gemini-2.5-flash' exists and is responding.");
        console.log(`Response: ${(response as any).text()}`);
    } catch (e: any) {
        console.error("❌ FAILED. 'gemini-2.5-flash' returned an error.");
        console.error(`Error Message: ${e.message}`);

        if (e.message?.includes("404") || e.message?.includes("not found")) {
            console.log("\n💡 Analysis: The model ID 'gemini-2.5-flash' is invalid on the public API.");
            console.log("👉 Suggestion: Stick with 'gemini-2.0-flash-exp'.");
        }
    }
}

probe();
