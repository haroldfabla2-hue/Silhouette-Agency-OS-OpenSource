
import { DEFAULT_API_CONFIG } from '../constants';

async function testEndpoint() {
    const url = `http://localhost:${DEFAULT_API_CONFIG.port}/v1/squads`;
    console.log(`Testing URL: ${url}`);

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
        });

        console.log(`Status: ${res.status} ${res.statusText}`);

        if (res.ok) {
            const data = await res.json();
            console.log(`Data Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
            console.log(`Item Count: ${Array.isArray(data) ? data.length : 'N/A'}`);
            if (Array.isArray(data) && data.length > 0) {
                console.log("Sample Item:", JSON.stringify(data[0], null, 2));
            }
        } else {
            console.log("Response Body:", await res.text());
        }
    } catch (e) {
        console.error("Fetch Failed:", e.message);
        console.log("Make sure the server is running with 'npm run server'");
    }
}

testEndpoint();
