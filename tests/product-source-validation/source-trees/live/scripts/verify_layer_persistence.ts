
import { DEFAULT_API_CONFIG } from '../constants';
import fetch from 'node-fetch';

async function verifyLayerPersistence() {
    console.log("🧪 Verifying Introspection Layer Persistence...");

    const setLayer = async (layer: number) => {
        const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/introspection/layer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
            },
            body: JSON.stringify({ layer })
        });
        return res.json();
    };

    const getLayer = async () => {
        const res = await fetch(`http://localhost:${DEFAULT_API_CONFIG.port}/v1/introspection/state`, {
            headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
        });
        const data = await res.json() as any;
        return data.layer;
    };

    // 1. Set to MAX (48)
    console.log("   👉 Setting Layer to 48...");
    await setLayer(48);

    // 2. Verify
    const layer1 = await getLayer();
    if (layer1 === 48) {
        console.log("   ✅ Layer 48 persisted successfully.");
    } else {
        console.error(`   ❌ Failed: Expected 48, got ${layer1}`);
    }

    // 3. Set back to OPTIMAL (32)
    console.log("   👉 Resetting Layer to 32...");
    await setLayer(32);

    // 4. Verify
    const layer2 = await getLayer();
    if (layer2 === 32) {
        console.log("   ✅ Layer 32 persisted successfully.");
    } else {
        console.error(`   ❌ Failed: Expected 32, got ${layer2}`);
    }
}

verifyLayerPersistence();
