
import { DEFAULT_API_CONFIG } from '../constants';
import { MemoryTier } from '../types';

const API_URL = `http://localhost:${DEFAULT_API_CONFIG.port}/v1`;
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callApi(endpoint: string, method: string = 'GET', body?: any) {
    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method,
            headers: HEADERS,
            body: body ? JSON.stringify(body) : undefined
        });
        return await res.json();
    } catch (e) {
        console.error(`❌ API Call Failed [${endpoint}]:`, e);
    }
}

async function seedFullSpectrum() {
    console.log("🌈 Seeding Full Spectrum Memory (L1 - L5)...");

    // 1. L1: Fresh Sensory Input
    console.log("👉 Seeding L1 (Ultra-Short)...");
    await callApi('/memory/node', 'POST', {
        content: "User just adjusted the volume slider.",
        tier: MemoryTier.ULTRA_SHORT,
        tags: ['ui', 'sensory']
    });

    // 2. L2: Working Context (Promoted from L1)
    console.log("👉 Seeding L2 (Short)...");
    await callApi('/memory/node', 'POST', { content: "User is working on the Memory Module.", tier: MemoryTier.ULTRA_SHORT, tags: ['context'] });
    await callApi('/memory/debug/age', 'POST', { nodeId: 'Memory Module', ageMs: 20000 });
    // Target L2: Access >= 2. We give 3. Stability default is 0.
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'Memory Module', accessBoost: 3, stabilityBoost: 10 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'FAST' }); // Promote to L2. Safe from L3 (needs >5 access).

    // 3. L3: Episodic Memory (Promoted from L2)
    console.log("👉 Seeding L3 (Medium)...");
    await callApi('/memory/node', 'POST', { content: "We fixed the CORS issue in the previous session.", tier: MemoryTier.ULTRA_SHORT, tags: ['episode', 'fix'] });
    // Move to L2
    await callApi('/memory/debug/age', 'POST', { nodeId: 'CORS', ageMs: 20000 });
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'CORS', accessBoost: 3, stabilityBoost: 10 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'FAST' });
    // Move to L3
    // Target L3: Access > 5. We give +4 (Total 7). Stability < 80. We give +40 (Total 50).
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'CORS', accessBoost: 4, stabilityBoost: 40 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'MEDIUM' }); // Promote to L3. Safe from L4 (needs >80 stability).

    // 4. L4: Semantic Knowledge (Promoted from L3)
    console.log("👉 Seeding L4 (Long)...");
    await callApi('/memory/node', 'POST', { content: "The system uses a 5-tier architecture for memory management.", tier: MemoryTier.ULTRA_SHORT, tags: ['knowledge', 'architecture'] });
    // Fast forward to L4
    await callApi('/memory/debug/age', 'POST', { nodeId: '5-tier', ageMs: 20000 });
    await callApi('/memory/debug/boost', 'POST', { nodeId: '5-tier', accessBoost: 3, stabilityBoost: 10 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'FAST' }); // L2
    await callApi('/memory/debug/boost', 'POST', { nodeId: '5-tier', accessBoost: 4, stabilityBoost: 40 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'MEDIUM' }); // L3
    // Target L4: Stability > 80. We give +40 (Total 90).
    await callApi('/memory/debug/boost', 'POST', { nodeId: '5-tier', accessBoost: 5, stabilityBoost: 40 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'SLOW' }); // L4. Safe from L5 (needs IDENTITY).

    // 5. L5: Core Identity (Promoted from L4)
    console.log("👉 Seeding L5 (Deep)...");
    await callApi('/memory/node', 'POST', { content: "I am Silhouette, an autonomous agency OS.", tier: MemoryTier.ULTRA_SHORT, tags: ['identity', 'self'] });
    // Warp speed to L5
    await callApi('/memory/debug/age', 'POST', { nodeId: 'Silhouette', ageMs: 20000 });
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'Silhouette', accessBoost: 3, stabilityBoost: 10 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'FAST' }); // L2
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'Silhouette', accessBoost: 4, stabilityBoost: 40 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'MEDIUM' }); // L3
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'Silhouette', accessBoost: 5, stabilityBoost: 40 });
    await callApi('/memory/debug/tick', 'POST', { tier: 'SLOW' }); // L4
    // Target L5: IDENTITY tag.
    await callApi('/memory/debug/boost', 'POST', { nodeId: 'Silhouette', addIdentityTag: true });
    await callApi('/memory/debug/tick', 'POST', { tier: 'DEEP' }); // L5

    console.log("✅ Full Spectrum Seeded. Check the Dashboard!");
}

seedFullSpectrum();
