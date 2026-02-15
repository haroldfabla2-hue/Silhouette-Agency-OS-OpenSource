import fetch from 'node-fetch';

const API_PORT = 3001;
const API_KEY = 'sk-silhouette-default';
const URL = `http://localhost:${API_PORT}/v1/graph/visualize`;

async function testGraphEndpoint() {
    console.log(`[TEST] Connecting to ${URL}...`);
    try {
        const res = await fetch(URL, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`[TEST] Status: ${res.status} ${res.statusText}`);

        if (!res.ok) {
            const text = await res.text();
            console.error(`[TEST] Error Body: ${text}`);
            return;
        }

        const data = await res.json() as any;
        console.log(`[TEST] Success! Received Data:`);
        console.log(`[TEST] Nodes: ${data.nodes ? data.nodes.length : 'undefined'}`);
        console.log(`[TEST] Links: ${data.links ? data.links.length : 'undefined'}`);

        if (data.nodes && data.nodes.length > 0) {
            console.log(`[TEST] Sample Node:`, JSON.stringify(data.nodes[0], null, 2));
        } else {
            console.warn(`[TEST] WARNING: Node array is empty!`);
        }

    } catch (error) {
        console.error(`[TEST] Connection Failed:`, error);
    }
}

testGraphEndpoint();
