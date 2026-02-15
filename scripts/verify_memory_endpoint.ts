
import { DEFAULT_API_CONFIG } from '../constants';

async function checkMemoryEndpoint() {
    console.log("Checking /v1/memory/state Endpoint...");
    try {
        const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/memory/state`, {
            headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
        });

        if (res.ok) {
            const json = await res.json();
            console.log("✅ Endpoint Accessible.");
            console.log("Memory Tiers Found:", Object.keys(json.nodes));
            console.log("Stats:", json.stats);

            // Check if DEEP tier is present
            if (json.nodes.DEEP) {
                console.log(`✅ DEEP Tier Present with ${json.nodes.DEEP.length} nodes.`);
            } else {
                console.error("❌ DEEP Tier missing from response.");
            }
        } else {
            console.error(`❌ Endpoint Failed: ${res.status} ${res.statusText}`);
            const text = await res.text();
            console.error("Response:", text);
        }
    } catch (e) {
        console.error("❌ Error checking endpoint:", e);
    }
}

checkMemoryEndpoint();
