
import { introspection } from '../services/introspectionEngine';
import { continuum } from '../services/continuumMemory';

async function verifyConnection() {
    console.log("🔌 Verifying Introspection <-> Continuum Connection...");

    const testConcept = "VerificationVector_" + Date.now();

    // 1. Trigger Introspection Action (should write to Continuum)
    console.log(`1. Injecting concept: ${testConcept}`);
    introspection.injectConcept(testConcept, 1.0, 32);

    // 2. Force Persistence (bypass debounce for test)
    console.log("2. Forcing Memory Persistence...");
    continuum.forceSave();

    // 3. Retrieve from Continuum
    console.log("3. Retrieving from Continuum...");
    // Allow a tiny tick for the in-memory array to update if needed (synchronous usually, but good practice)
    await new Promise(r => setTimeout(r, 100));

    const memories = await continuum.retrieve(testConcept);
    const match = memories.find(m => m.content.includes(testConcept));

    if (match) {
        console.log("✅ CONNECTION VERIFIED: Introspection event found in Continuum Memory.");
        console.log(`   - Memory ID: ${match.id}`);
        console.log(`   - Content: ${match.content}`);
        console.log(`   - Tags: ${match.tags.join(', ')}`);
    } else {
        console.error("❌ CONNECTION FAILED: Introspection event NOT found in Continuum Memory.");
        console.log("   - Retrieved memories:", memories.length);
    }
}

verifyConnection();
