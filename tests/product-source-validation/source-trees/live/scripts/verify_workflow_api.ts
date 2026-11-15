
import axios from 'axios';

const API_URL = 'http://localhost:3005/v1';

async function verifyWorkflowApi() {
    console.log("Starting Workflow API Verification...");

    try {
        // 1. Verify Quality Score Endpoint
        console.log("\n[TEST 1] Testing /workflow/quality...");
        const qualityRes = await axios.get(`${API_URL}/workflow/quality`);
        if (qualityRes.status === 200 && qualityRes.data.score !== undefined) {
            console.log("✅ /workflow/quality success:", qualityRes.data);
        } else {
            console.error("❌ /workflow/quality failed:", qualityRes.status, qualityRes.data);
        }

        // 2. Verify Orchestrator State (Indirect check for persistence loader, though we can't restart server here)
        console.log("\n[TEST 2] Testing /orchestrator/squads (Dependencies check)...");
        const squadsRes = await axios.get(`${API_URL}/orchestrator/squads`);
        if (squadsRes.status === 200 && Array.isArray(squadsRes.data)) {
            console.log(`✅ /orchestrator/squads success: retrieved ${squadsRes.data.length} squads.`);
        } else {
            console.error("❌ /orchestrator/squads failed:", squadsRes.status);
        }

        console.log("\nVerification Complete.");

    } catch (error: any) {
        console.error("❌ Verification failed.");
        if (error.code) {
            console.error(`Code: ${error.code}`);
        }
        console.error(`Message: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, error.response.data);
        } else if (error.request) {
            console.error("No response received from server. Is the server running?");
        }
    }
}

verifyWorkflowApi();
