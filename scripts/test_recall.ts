import { DEFAULT_API_CONFIG } from '../constants';

const API_URL = `http://localhost:${DEFAULT_API_CONFIG.port}/v1`;
const API_KEY = 'sk-silhouette-default';

async function runTest() {
    console.log("🕰️ --- STARTING TIME-TRAVEL QUERY TEST ---");

    // 0. HEALTH CHECKS
    console.log("0. Checking Infrastructure...");
    try {
        const geminiCheck = await fetch(`${API_URL}/debug/gemini`, { headers: { 'Authorization': `Bearer ${API_KEY}` } }).then(r => r.json());
        console.log(`   - Gemini: ${geminiCheck.success ? '✅' : '❌'} (${geminiCheck.message})`);

        const qdrantCheck = await fetch(`${API_URL}/debug/qdrant`, { headers: { 'Authorization': `Bearer ${API_KEY}` } }).then(r => r.json());
        console.log(`   - Qdrant: ${qdrantCheck.success ? '✅' : '❌'} (${qdrantCheck.message})`);

        if (!geminiCheck.success || !qdrantCheck.success) {
            console.error("🛑 ABORTING: Infrastructure unhealthy.");
            return;
        }
    } catch (e) {
        console.error("🛑 ABORTING: Server not responding or debug endpoints missing (Restart Server!).", e);
        return;
    }

    // 1. Inject a NEW Memory (to ensure it has real embeddings)
    const memoryContent = `
    The 'Project Chronos' prototype failed because the flux capacitor overheated at 88mph. 
    Dr. Brown suggests using plutonium instead of trash for the next iteration.
    `;

    console.log("\n1. Injecting Memory about 'Project Chronos'...");
    await fetch(`${API_URL}/memory/node`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            content: memoryContent,
            tier: 'MEDIUM',
            tags: ['prototype', 'failure', 'science'],
            importance: 0.9
        })
    });

    // 2. Boost to Force Digestion
    console.log("2. Boosting & Digesting...");
    // Workaround: Server hardcodes boost to 50. We need > 80. So we boost twice.
    await fetch(`${API_URL}/memory/debug/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ nodeId: 'Project Chronos' })
    });
    await fetch(`${API_URL}/memory/debug/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ nodeId: 'Project Chronos' })
    });

    // DEBUG: Check State Before Tick
    const state1 = await fetch(`${API_URL}/memory/state`, { headers: { 'Authorization': `Bearer ${API_KEY}` } }).then(r => r.json());
    const nodeL3 = state1.nodes.MEDIUM.find((n: any) => n.content.includes('Chronos'));
    console.log(`   - Node Status (Pre-Digest): Found in L3? ${!!nodeL3} | Score: ${nodeL3?.stabilityScore}`);

    // EXPLICIT DIGESTION (Bypassing Tick Loop for determinism)
    console.log("   (Triggering Explicit Digestion...)");
    const digestResRaw = await fetch(`${API_URL}/memory/debug/digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ nodeId: 'Project Chronos' })
    });

    if (!digestResRaw.ok) {
        console.error(`   ❌ Digestion Request Failed: ${digestResRaw.status} ${digestResRaw.statusText}`);
        console.error("   Response:", await digestResRaw.text());
        return;
    }

    const digestRes = await digestResRaw.json();

    if (digestRes.success) {
        console.log(`   ✅ Digestion Complete. Extracted ${digestRes.insights.length} insights.`);
    } else {
        console.error("   ❌ Digestion Failed:", digestRes.error);
        return;
    }

    // Wait a bit for Qdrant indexing (just in case)
    await new Promise(r => setTimeout(r, 2000));

    // 3. Time-Travel Query

    // 3. Time-Travel Query
    const query = "Why did the prototype fail?";
    console.log(`\n3. 🔮 Querying Past: "${query}"`);

    const res = await fetch(`${API_URL}/memory/recall?q=${encodeURIComponent(query)}&limit=3`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
    });

    const data = await res.json();

    if (data.results && data.results.length > 0) {
        console.log("\n✅ RECALL SUCCESSFUL!");
        data.results.forEach((r: any) => {
            console.log(`   - [${r.type}] ${r.content} (Confidence: ${r.confidence.toFixed(2)})`);
        });
    } else {
        console.log("\n❌ RECALL FAILED (No results found).");
        console.log("Debug:", JSON.stringify(data, null, 2));
    }
}

runTest().catch(console.error);
