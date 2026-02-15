import fetch from 'node-fetch';

const API_URL = 'http://localhost:3000/v1/memory/state';
const API_KEY = 'sk-silhouette-default'; // Default dev key

async function verifyMemory() {
    try {
        const response = await fetch(API_URL, {
            headers: { 'Authorization': `Bearer ${API_KEY}` }
        });

        if (!response.ok) {
            console.error(`API Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response Body:", text);
            return;
        }

        const data = await response.json() as any;
        console.log("API Response Status:", response.status);

        if (data.nodes) {
            console.log("Nodes Structure Found.");
            console.log("ULTRA_SHORT count:", data.nodes.ULTRA_SHORT?.length || 0);
            console.log("SHORT count:", data.nodes.SHORT?.length || 0);
            console.log("MEDIUM count:", data.nodes.MEDIUM?.length || 0);
            console.log("DEEP count:", data.nodes.DEEP?.length || 0);

            // Print first few nodes to check content
            if (data.nodes.ULTRA_SHORT?.length > 0) {
                console.log("Sample ULTRA_SHORT:", JSON.stringify(data.nodes.ULTRA_SHORT[0], null, 2));
            }
        } else {
            console.error("Missing 'nodes' property in response:", Object.keys(data));
        }

    } catch (e) {
        console.error("Verification Failed:", e);
    }
}

verifyMemory();
