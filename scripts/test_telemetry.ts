import fetch from 'node-fetch';

const API_PORT = 3001;
const API_KEY = 'sk-silhouette-default';
const URL = `http://localhost:${API_PORT}/v1/system/telemetry`;

async function testTelemetry() {
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

        const data = await res.json();
        console.log(`[TEST] Success! Received Telemetry:`);
        console.log(JSON.stringify(data, null, 2));

    } catch (error) {
        console.error(`[TEST] Connection Failed:`, error);
        console.log(`[TEST] DIAGNOSIS: The server at port ${API_PORT} is unreachable.`);
        console.log(`[TEST] SUGGESTION: Check if the server terminal is running or if it crashed.`);
    }
}

testTelemetry();
