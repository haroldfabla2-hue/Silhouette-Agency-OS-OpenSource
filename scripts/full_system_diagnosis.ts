
import { introspection } from '../services/introspectionEngine';
import { continuum } from '../services/continuumMemory';
import { DEFAULT_API_CONFIG } from '../constants';
import fetch from 'node-fetch';

async function runDiagnosis() {
    console.log("🏥 STARTING FULL SYSTEM DIAGNOSIS...");
    const results = {
        api: false,
        memory: false,
        introspection: false,
        link: false
    };

    // 1. TEST API ENDPOINT (Introspection Hub Connection)
    console.log("\n1️⃣  Testing Introspection API Endpoint...");
    try {
        const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/introspection/state`, {
            headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            console.log("   ✅ API is ONLINE and responding.");
            console.log(`   - Active Concepts: ${data.activeConcepts?.length || 0}`);
            console.log(`   - Recent Thoughts: ${data.thoughts?.length || 0}`);
            results.api = true;
        } else {
            console.error(`   ❌ API Error: ${res.status} ${res.statusText}`);
        }
    } catch (e: any) {
        console.error(`   ❌ API Connection Failed: ${e.message}`);
        console.log("      (Make sure the server is running with 'npm run server')");
    }

    // 2. TEST CONTINUUM MEMORY (Persistence)
    console.log("\n2️⃣  Testing Continuum Memory Persistence...");
    try {
        const testId = `DIAG_MEM_${Date.now()}`;
        await continuum.store(`[DIAGNOSIS] System Check: ${testId}`, undefined, ['system', 'diagnosis']);

        // Force save to ensure it hits disk/storage
        continuum.forceSave();

        // Retrieve
        const memories = await continuum.retrieve('System Check');
        const match = memories.find(m => m.content.includes(testId));

        if (match) {
            console.log("   ✅ Memory Write/Read Verified.");
            console.log(`   - ID: ${match.id}`);
            results.memory = true;
        } else {
            console.error("   ❌ Memory Retrieval Failed. Item not found.");
        }
    } catch (e: any) {
        console.error(`   ❌ Memory Error: ${e.message}`);
    }

    // 3. TEST INTROSPECTION ENGINE (Internal Logic)
    console.log("\n3️⃣  Testing Introspection Engine Logic...");
    try {
        const thoughts = ["Diagnosis in progress", "Checking neural pathways"];
        introspection.setRecentThoughts(thoughts);
        const retrieved = introspection.getRecentThoughts();

        if (retrieved.length === 2 && retrieved[0] === thoughts[0]) {
            console.log("   ✅ Introspection State Management Verified.");
            results.introspection = true;
        } else {
            console.error("   ❌ Introspection State Mismatch.");
        }
    } catch (e: any) {
        console.error(`   ❌ Introspection Error: ${e.message}`);
    }

    // 4. TEST LINK (Introspection -> Memory)
    console.log("\n4️⃣  Testing Introspection -> Memory Link...");
    try {
        const concept = `LINK_TEST_${Date.now()}`;
        introspection.injectConcept(concept, 1.0, 32);
        continuum.forceSave();

        // Wait briefly for async operations
        await new Promise(r => setTimeout(r, 500));

        const linkMemories = await continuum.retrieve(concept);
        if (linkMemories.length > 0) {
            console.log("   ✅ Link Verified: Injected concept found in memory.");
            results.link = true;
        } else {
            console.error("   ❌ Link Failed: Injected concept NOT found in memory.");
        }
    } catch (e: any) {
        console.error(`   ❌ Link Error: ${e.message}`);
    }

    console.log("\n📊 DIAGNOSIS SUMMARY:");
    console.log(`   API:           ${results.api ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   MEMORY:        ${results.memory ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   INTROSPECTION: ${results.introspection ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   LINK:          ${results.link ? '✅ PASS' : '❌ FAIL'}`);

    if (Object.values(results).every(v => v)) {
        console.log("\n✨ SYSTEM STATUS: OPTIMAL");
    } else {
        console.log("\n⚠️  SYSTEM STATUS: DEGRADED - Check logs above.");
    }
}

runDiagnosis();
