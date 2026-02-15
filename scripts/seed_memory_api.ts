
import { DEFAULT_API_CONFIG } from '../constants';
import { MemoryTier } from '../types';

async function seedMemory() {
    console.log("🌱 Seeding Memory via API (Single Source of Truth)...");

    const url = `http://localhost:${DEFAULT_API_CONFIG.port}/v1/memory/node`;
    const payload = {
        content: `[API_TEST] Hybrid Memory Architecture Verified at ${new Date().toISOString()}`,
        tier: MemoryTier.ULTRA_SHORT,
        tags: ['api-test', 'hybrid-architecture', 'sprint-1']
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const json = await res.json();
            console.log("✅ Injection Successful:", json);
            console.log("👉 Check the Dashboard UI now. The node should appear instantly.");
        } else {
            console.error("❌ Injection Failed:", res.status, await res.text());
        }
    } catch (e) {
        console.error("❌ Connection Failed:", e);
    }
}

seedMemory();
