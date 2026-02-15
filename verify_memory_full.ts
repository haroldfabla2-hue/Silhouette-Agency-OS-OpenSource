
import { continuumMemory } from './services/continuumMemory';
import { discoveryJournal } from './services/discoveryJournal';
import { synthesisService } from './services/synthesisService';
import { SystemProtocol } from './types';

async function verifySystem() {
    console.log("🔍 STARTING SYSTEM VERIFICATION...");

    // 1. MEMORY VERIFICATION
    console.log("\n[1/3] VERIFYING CONTINUUM MEMORY...");
    const testId = `TEST_FACT_${Date.now()}`;
    const testContent = `Verification Fact: Silhouette Agency OS uses a 4-tier memory system. ID: ${testId}`;

    try {
        await continuumMemory.store(testContent, 'WORKING' as any, ['VERIFICATION', 'TEST']);
        console.log("✅ Memory Stored.");

        // Allow slight delay for ingestion/indexing (if any)
        await new Promise(r => setTimeout(r, 1000));

        const results = await continuumMemory.retrieve(testId);
        const found = results.find(n => n.content.includes(testId));

        if (found) {
            console.log(`✅ Memory Retrieved: "${found.content.substring(0, 50)}..."`);
        } else {
            console.error("❌ Memory Retrieval FAILED. Fact not found.");
        }
    } catch (e) {
        console.error("❌ Memory Test Exception:", e);
    }

    // 2. DISCOVERY JOURNAL VERIFICATION
    console.log("\n[2/3] VERIFYING DISCOVERY JOURNAL (SQLite)...");
    const source = `Node_A_${Date.now()}`;
    const target = `Node_B_${Date.now()}`;

    try {
        discoveryJournal.logDecision({
            sourceNode: source,
            targetNode: target,
            decision: 'ACCEPT',
            confidence: 0.9,
            feedback: 'Test connection',
            relationType: 'TEST_RELATION',
            discoverySource: 'VERIFICATION_SCRIPT',
            metadata: { test: true }
        });
        console.log("✅ Discovery Logged.");

        const isAccepted = discoveryJournal.wasAccepted(source, target);
        if (isAccepted) {
            console.log("✅ Discovery Persistence Confirmed (wasAccepted = true).");
        } else {
            console.error("❌ Discovery Persistence FAILED.");
        }
    } catch (e) {
        console.error("❌ Discovery Test Exception:", e);
    }

    // 3. SYNTHESIS SERVICE VERIFICATION
    console.log("\n[3/3] VERIFYING SYNTHESIS SERVICE (Wiring)...");
    try {
        const stats = synthesisService.getStats();
        console.log("✅ Synthesis Service is active. Current Stats:", stats);
    } catch (e) {
        console.error("❌ Synthesis Service Exception:", e);
    }

    console.log("\n🏁 VERIFICATION COMPLETE.");
    process.exit(0);
}

// Run
verifySystem().catch(e => console.error("Fatal Error:", e));
