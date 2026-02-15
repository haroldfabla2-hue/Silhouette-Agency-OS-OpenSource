
import fs from 'fs';
import path from 'path';
import { dreamer } from '../services/dreamerService';
import { vectorMemory } from '../services/vectorMemoryService';
import { generateEmbedding, geminiService } from '../services/geminiService';
import { v4 as uuidv4 } from 'uuid';

// Helper to load env manually
function loadEnv() {
    console.log(`[DIAGNOSTIC] CWD: ${process.cwd()}`);
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            console.log("✅ .env.local found.");
            let content = fs.readFileSync(envPath, 'utf8');

            // 1. Strip Byte Order Mark (BOM) if present (Common in Windows)
            if (content.charCodeAt(0) === 0xFEFF) {
                console.log("[DIAGNOSTIC] BOM detected and removed.");
                content = content.slice(1);
            }

            const lines = content.split(/\r?\n/); // Handle CRLF and LF
            let keyFound = false;

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || trimmedLine.startsWith('#')) continue;

                const match = trimmedLine.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const key = match[1].trim();
                    const value = match[2].trim().replace(/^["']|["']$/g, '');

                    if (key === 'GEMINI_API_KEY') {
                        keyFound = true;
                        process.env[key] = value;
                        console.log(`[DIAGNOSTIC] GEMINI_API_KEY found: ${value.substring(0, 5)}...******`);
                        geminiService.configureGenAI(value);
                    } else {
                        // Load other keys too
                        process.env[key] = value;
                    }
                }
            }
            if (!keyFound) {
                console.warn("⚠️ .env.local parsed but GEMINI_API_KEY missing.");
                console.log("Keys found:", lines.map(l => l.split('=')[0]).filter(k => k && !k.startsWith('#')).join(', '));
            }
        } else {
            console.error("❌ .env.local NOT found at:", envPath);
        }
    } catch (e) {
        console.error("Failed to read .env.local:", e);
    }
}

async function testDeduplication() {
    console.log("\n--- DIAGNOSTIC START ---\n");
    loadEnv();

    console.log("\n--- API CHECK ---");
    // Test direct embedding generation to isolate API issues
    const testContent = "Sanity Check";
    console.log("Attempting to generate embedding for 'Sanity Check'...");

    try {
        const testVector = await generateEmbedding(testContent);

        if (!testVector) {
            console.error("❌ API returned NULL. This usually means:");
            console.error("   1. API Key is missing/empty internally.");
            console.error("   2. API Quota Exceeded (429).");
            console.error("   3. Invalid API Key (400/403).");
        } else {
            console.log("✅ API is working! Vector generated (Length: " + testVector.length + ")");
        }

        if (!testVector) {
            console.log("\n--- ABORTING TEST (Cannot proceed without API) ---");
            process.exit(1);
        }

        console.log("\n--- DEDUPLICATION TEST ---");
        // 1. Initialize Services
        await vectorMemory.connect();

        // 2. Insert Test Memory
        const uniqueId = uuidv4();
        const memoryText = `TEST_MEMORY_${uniqueId}: The sky is blue.`;

        console.log(`📝 Inserting: "${memoryText}"`);
        // We reuse the valid vector or generate new one
        const vec = await generateEmbedding(memoryText);

        if (vec) {
            await vectorMemory.storeMemory(uniqueId, vec, {
                content: memoryText,
                timestamp: Date.now(),
                tags: ['DIAGNOSTIC']
            });

            // Wait
            await new Promise(r => setTimeout(r, 1000));

            // 3. Check Redundancy
            console.log("🔍 Checking redundancy...");
            const isRedundant = await (dreamer as any).isRedundant(memoryText);

            if (isRedundant) {
                console.log("✅ SUCCESS: Deduplication Logic verified.");
            } else {
                console.error("❌ FAILURE: Deduplication Logic missed the duplicate.");
                const search = await vectorMemory.searchMemory(vec, 1);
                console.log("   Debug Search Top Score:", search.length ? search[0].score : "No result");
            }
        }

    } catch (e: any) {
        console.error("\n💥 CRITICAL EXCEPTION:", e);
        if (e.message?.includes('429')) console.error("   -> QUOTA EXCEEDED (Please check Google Cloud Console)");
        if (e.message?.includes('403')) console.error("   -> PERMISSION DENIED (Check API Key validity)");
    }
    process.exit(0);
}

testDeduplication();
