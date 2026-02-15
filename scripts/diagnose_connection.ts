
const API_URL = 'http://localhost:3001/v1/orchestrator/state';
const API_KEY = 'sk-silhouette-default';

async function testConnection() {
    console.log(`Testing connection to ${API_URL}...`);
    try {
        const res = await fetch(API_URL, {
            headers: { 'Authorization': `Bearer ${API_KEY}` }
        });
        console.log(`Status: ${res.status}`);
        if (res.ok) {
            const data = await res.json();
            console.log('Response:', JSON.stringify(data, null, 2));
        } else {
            console.log('Error Text:', await res.text());
        }
    } catch (error: any) {
        console.error('Connection Failed:', error.message);
        if (error.cause) console.error('Cause:', error.cause);
    }
}

testConnection();
