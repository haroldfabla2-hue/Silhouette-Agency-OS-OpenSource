
import { DEFAULT_API_CONFIG } from '../constants';

async function debugApi() {
    const url = `http://localhost:${DEFAULT_API_CONFIG.port}/v1/memory/state`;
    console.log(`Fetching from: ${url}`);

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
        });

        if (res.ok) {
            const json = await res.json();
            console.log("✅ API Response OK");
            console.log("Stats:", json.stats);
            console.log("Node Counts:");
            Object.keys(json.nodes).forEach(key => {
                console.log(`  ${key}: ${json.nodes[key].length}`);
            });
        } else {
            console.error("❌ API Error:", res.status, res.statusText);
            const text = await res.text();
            console.error("Body:", text);
        }
    } catch (e) {
        console.error("❌ Connection Failed:", e);
    }
}

debugApi();
