
const API_URL = 'http://127.0.0.1:3001/v1/system/stress-test';
const API_KEY = 'sk-silhouette-default-dev-key';

async function runStressTest() {
    console.log("🚀 Initiating Zero-Cost Stress Test (Fetch Mode)...");
    console.log(`Target: ${API_URL}`);

    try {
        const start = Date.now();
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                count: 50,
                topic: "STRESS_TEST_PROTOCOL_CHECK"
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        const totalTime = Date.now() - start;
        console.log("\n✅ Stress Test Complete!");
        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log(`Events Emitted: ${data.emitted}`);
        console.log(`Server Processing Time: ${data.duration}ms`);
        console.log(`Total Round Trip: ${totalTime}ms`);

    } catch (error: any) {
        console.error("\n❌ Stress Test Failed!");
        console.error(`Error: ${error.message}`);
    }
}

runStressTest();
