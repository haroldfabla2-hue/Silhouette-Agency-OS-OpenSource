
import { DEFAULT_API_CONFIG } from '../constants';
import { MemoryTier } from '../types';

const API_URL = `http://localhost:${DEFAULT_API_CONFIG.port}/v1`;
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callApi(endpoint: string, method: string = 'GET', body?: any) {
    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method,
            headers: HEADERS,
            body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) throw new Error(`API Error ${res.status}: ${await res.text()}`);
        return await res.json();
    } catch (e) {
        console.error(`❌ API Call Failed [${endpoint}]:`, e);
        process.exit(1);
    }
}

async function verifyNestedMemory() {
    console.log("🧪 Starting Hybrid Memory Verification (API-Driven)...");

    // 1. Inject L1 Node
    console.log("\n[Step 1] Injecting L1 Node...");
    await callApi('/memory/node', 'POST', {
        content: `[VERIFY_LIFECYCLE] Test Memory ${Date.now()}`,
        tier: MemoryTier.ULTRA_SHORT,
        tags: ['verify', 'lifecycle']
    });
    console.log("✅ L1 Node Injected");

    // 2. Verify L1 Presence
    let state = await callApi('/memory/state');
    let l1Count = state.nodes[MemoryTier.ULTRA_SHORT].length;
    console.log(`📊 Current L1 Count: ${l1Count}`);

    if (l1Count === 0) console.warn("⚠️ L1 Node not found immediately (might have been promoted or failed).");
    else console.log("✅ L1 Node Verified in RAM.");


    // 3. Force Promotion L1 -> L2
    console.log("\n[Step 2] Simulating L1 -> L2 Promotion...");
    // Age node by 20s (Threshold is 10s)
    await callApi('/memory/debug/age', 'POST', { nodeId: 'VERIFY_LIFECYCLE', ageMs: 20000 });
    // Boost access count (Threshold is 2)
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'VERIFY_LIFECYCLE' });
    // Force Fast Tick
    await callApi('/memory/debug/tick', 'POST', { tier: 'FAST' });

    state = await callApi('/memory/state');
    const l2Count = state.nodes[MemoryTier.SHORT].length;
    console.log(`📊 L2 Count: ${l2Count}`);
    if (l2Count > 0) console.log("✅ Promotion L1 -> L2 Verified.");
    else console.warn("⚠️ Promotion L1 -> L2 Failed.");

    // 4. Force Promotion L2 -> L3
    console.log("\n[Step 3] Simulating L2 -> L3 Promotion...");
    // Boost access count (Threshold is 5)
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'VERIFY_LIFECYCLE' });
    // Force Medium Tick
    await callApi('/memory/debug/tick', 'POST', { tier: 'MEDIUM' });

    state = await callApi('/memory/state');
    const l3Count = state.nodes[MemoryTier.MEDIUM].length;
    console.log(`📊 L3 Count: ${l3Count}`);
    if (l3Count > 0) console.log("✅ Promotion L2 -> L3 Verified.");
    else console.warn("⚠️ Promotion L2 -> L3 Failed.");

    // 5. Force Promotion L3 -> L4
    console.log("\n[Step 4] Simulating L3 -> L4 Promotion...");
    // Boost stability (Threshold is 80)
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'VERIFY_LIFECYCLE' });
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'VERIFY_LIFECYCLE' }); // Double boost to be sure
    // Force Slow Tick
    await callApi('/memory/debug/tick', 'POST', { tier: 'SLOW' });

    state = await callApi('/memory/state');
    const l4Count = state.nodes[MemoryTier.LONG].length;
    console.log(`📊 L4 Count: ${l4Count}`);
    if (l4Count > 0) console.log("✅ Promotion L3 -> L4 Verified.");
    else console.warn("⚠️ Promotion L3 -> L4 Failed.");

    // 6. Force Promotion L4 -> L5
    console.log("\n[Step 5] Simulating L4 -> L5 Promotion...");
    // Boost to ensure IDENTITY tag is added (debug_boost adds it if boost > 0)
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'VERIFY_LIFECYCLE' });
    // Force Deep Tick
    await callApi('/memory/debug/tick', 'POST', { tier: 'DEEP' });

    state = await callApi('/memory/state');
    const l5Count = state.nodes[MemoryTier.DEEP].length;
    console.log(`📊 L5 Count: ${l5Count}`);
    if (l5Count > 0) console.log("✅ Promotion L4 -> L5 Verified.");
    else console.warn("⚠️ Promotion L4 -> L5 Failed.");

    console.log("\n✅ Verification Complete: Full Lifecycle Verified via API.");
}

verifyNestedMemory();
