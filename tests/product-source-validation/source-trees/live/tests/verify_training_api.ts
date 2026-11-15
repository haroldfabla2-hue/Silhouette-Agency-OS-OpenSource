
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';
import { DEFAULT_API_CONFIG } from '../constants';

// Mock Fetch if not available (node environment)
// But we should use the actual fetch against localhost if server is running.
// This script assumes the SERVER IS RUNNING.

const API_URL = "http://localhost:3000";
const API_KEY = DEFAULT_API_CONFIG.apiKey;

async function testTrainingFlow() {
    console.log("🧪 STARTING TRAINING API VERIFICATION");

    // 1. Emit a Training Event via API (Simulate Learning)
    console.log("1. Simulating Learning Event via API Ingest...");
    const testId = `TEST_${Date.now()}`;

    try {
        const ingestRes = await fetch(`${API_URL}/v1/training/ingest?apiKey=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                input: `Test Input ${testId}`,
                output: `Test Output ${testId}`,
                score: 0.99,
                tags: ['verification', 'api_test'],
                source: 'VerifyScript'
            })
        });

        if (!ingestRes.ok) {
            const errBody = await ingestRes.text();
            console.error(`❌ INGEST FAILED (${ingestRes.status}):`, errBody);
            throw new Error(`Ingest Failed: ${ingestRes.status}`);
        }
        console.log("   ✅ Event Ingested.");

    } catch (e) {
        console.error("❌ INGEST FAILED:", e);
        process.exit(1);
    }

    // Wait for DataCollector to process (it's synchronous but event loop needs a tick)
    await new Promise(r => setTimeout(r, 1000));

    // 2. Query the API
    console.log("2. Querying API /v1/training/latest...");
    try {
        const res = await fetch(`${API_URL}/v1/training/latest?limit=5&apiKey=${API_KEY}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}` }
        });

        if (!res.ok) throw new Error(`API Error: ${res.status}`);

        const data = await res.json();
        console.log("   API Response:", JSON.stringify(data, null, 2));

        // 3. Verify
        const found = data.examples.find((e: any) => e.input.includes(testId));
        if (found) {
            console.log("✅ SUCCESS: Training example successfully retrieved from API.");
        } else {
            console.error("❌ FAILURE: Created example not found in API response.");
            process.exit(1);
        }

    } catch (e) {
        console.error("❌ CONNECTION FAILED:", e);
        console.log("   (Ensure the server is running with 'npm run server' or 'start_all.bat')");
        process.exit(1);
    }

    // 4. Check Stats
    console.log("4. Checking Stats Endpoint...");
    try {
        const res = await fetch(`${API_URL}/v1/training/stats?apiKey=${API_KEY}`);
        const stats = await res.json();
        console.log("   Stats:", stats);
        if (stats.bufferCount >= 0 && stats.totalSaved >= 0) {
            console.log("✅ SUCCESS: Stats retrieved.");
        }
    } catch (e) {
        console.warn("   Stats check failed", e);
    }

    process.exit(0);
}

testTrainingFlow();
