import { DEFAULT_API_CONFIG } from '../constants';

const API_URL = `http://localhost:${DEFAULT_API_CONFIG.port}/v1`;
const API_KEY = 'sk-silhouette-default';

async function runTest() {
    console.log("🧪 --- STARTING DIGESTION PROTOCOL TEST ---");

    // 1. Inject Complex Memory
    const complexMemory = `
    Yesterday, the team met at the virtual HQ to discuss the new 'Quantum UI' update. 
    Sarah suggested using neon blue (#00FFFF) for the primary accents, but Mike argued that it strains the eyes. 
    We eventually agreed on a compromise: 'Cyber Teal' for dark mode and 'Slate Blue' for light mode. 
    The deadline for the beta release is set for next Friday. 
    Also, we discovered that the Redis cache was causing latency in the auth service.
    `;

    console.log("\n1. Injecting Memory...");
    const res1 = await fetch(`${API_URL}/memory/node`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            content: complexMemory,
            tier: 'MEDIUM', // Start at L3 to be ready for L4 promotion
            tags: ['meeting', 'design', 'bugfix'],
            importance: 0.8
        })
    });
    console.log("Injection Result:", await res1.json());

    // 2. Boost Node to Force Promotion
    // We need the ID, but the API doesn't return it explicitly in the simple response (oops).
    // But we can boost by content match!
    console.log("\n2. Boosting Memory Stability...");
    await fetch(`${API_URL}/memory/debug/boost`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            nodeId: 'Quantum UI', // Partial match
            accessBoost: 20,
            stabilityBoost: 100 // Instant eligibility for L4
        })
    });
    console.log("Boost applied.");

    // 3. Trigger Maintenance (The Digestion Cycle)
    console.log("\n3. Triggering SLOW Maintenance (Digestion)...");
    console.log("👀 WATCH SERVER LOGS FOR '[SEMANTIC]' OUTPUT!");

    await fetch(`${API_URL}/memory/maintenance`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({ type: 'SLOW' })
    });

    console.log("\n✅ Test sequence complete. Check your server terminal.");
}

runTest().catch(console.error);
