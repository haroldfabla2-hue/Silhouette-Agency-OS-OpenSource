import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { continuum } from './services/continuumMemory';
import { MemoryTier } from './types';
import { vectorMemory } from './services/vectorMemoryService';

async function seed() {
    console.log("🌱 Seeding Continuum Memory...");

    // 1. Seed RAM (Ultra Short)
    await continuum.store("User is asking about memory tiers.", MemoryTier.ULTRA_SHORT, ['user-input', 'context']);
    await continuum.store("I am debugging the memory display.", MemoryTier.ULTRA_SHORT, ['internal', 'debug']);
    await continuum.store("Short term working memory test.", MemoryTier.SHORT, ['test']);

    // 2. Seed Persistent (Medium/Long via Continuum Store to trigger LanceDB)
    await continuum.store("This is a medium term memory about project structure.", MemoryTier.MEDIUM, ['architecture']);
    await continuum.store("Users prefer robust solutions over temporary fixes.", MemoryTier.LONG, ['preference', 'user-rule']);

    // 3. Seed Deep (Vector) - Direct via Service to ensure it bypasses filters
    if (process.env.QDRANT_URL || process.env.QDRANT_API_KEY) {
        console.log("Testing Deep Memory Connection...");
        await vectorMemory.connect();
        await vectorMemory.storeMemory("TEST-DEEP-001", new Array(768).fill(0.1), {
            id: "TEST-DEEP-001",
            content: "The core philosophy of Silhouette is Evolutionary Autonomy.",
            tags: ['core', 'philosophy', 'IDENTITY'],
            timestamp: Date.now(),
            tier: MemoryTier.DEEP
        });
        console.log("✅ Deep Memory Seeded.");
    } else {
        console.log("⚠️ Skipping Deep Memory (No Qdrant Creds/URL detected in env vars for script context).");
    }

    console.log("✅ Seeding Complete. Please Refresh the UI.");
}

seed().catch(console.error);
