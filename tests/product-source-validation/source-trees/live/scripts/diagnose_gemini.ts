
import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';

// Load Env manually since we are running as a script
const envPath = path.resolve(process.cwd(), '.env.local');
let apiKey = process.env.GEMINI_API_KEY;

if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    const match = envConfig.match(/GEMINI_API_KEY=(.*)/);
    if (match) {
        apiKey = match[1].trim();
        console.log("Found API Key in .env.local");
    }
}

if (!apiKey) {
    console.error("❌ No API Key found in environment or .env.local");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function runDiagnosis() {
    console.log("🔍 Starting Gemini API Diagnosis (Round 2)...");
    console.log("-----------------------------------");

    // 1. List Models (Attempt)
    try {
        console.log("1️⃣  Listing Models...");
        // @ts-ignore
        const response = await ai.models.list();
        console.log("   RAW LIST RESPONSE:", JSON.stringify(response, null, 2));
    } catch (e: any) {
        console.error("   ❌ Failed to list models:", e.message);
    }

    // 2. Test gemini-2.5-flash (Short Name)
    try {
        console.log("\n2️⃣  Testing 'gemini-2.5-flash'...");
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: "Hi" }] }]
        } as any);
        console.log("   ✅ Success! Response:", response.text?.substring(0, 20));
    } catch (e: any) {
        console.error("   ❌ Failed:", e.message);
    }

    // 3. Test models/gemini-2.5-flash (Full Name)
    try {
        console.log("\n3️⃣  Testing 'models/gemini-2.5-flash'...");
        const response = await ai.models.generateContent({
            model: 'models/gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: "Hi" }] }]
        } as any);
        console.log("   ✅ Success! Response:", response.text?.substring(0, 20));
    } catch (e: any) {
        console.error("   ❌ Failed:", e.message);
    }

    // 4. Test Streaming (gemini-2.5-flash)
    try {
        console.log("\n4️⃣  Testing Streaming 'gemini-2.5-flash'...");
        const result = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: "Story." }] }]
        } as any);

        console.log("   Stream started...");
        let text = "";
        // @ts-ignore
        for await (const chunk of result.stream || result) {
            console.log("\n   [DEBUG] Chunk Keys:", Object.keys(chunk));
            console.log("   [DEBUG] Chunk Content:", JSON.stringify(chunk, null, 2));
            try {
                // @ts-ignore
                text += chunk.text ? (typeof chunk.text === 'function' ? chunk.text() : chunk.text) : "";
            } catch (e) {
                console.log("   [DEBUG] chunk.text() failed");
            }
            process.stdout.write(".");
        }
        console.log("\n   ✅ Streaming Success! Length:", text.length);
    } catch (e: any) {
        console.error("\n   ❌ Streaming Failed:", e.message);
    }
}

runDiagnosis();
