
import { continuum } from '../services/continuumMemory';
import { lancedbService } from '../services/lancedbService';
import { redisClient } from '../services/redisClient';
import { MemoryTier, MemoryNode } from '../types';

async function testPersistence() {
    console.log("🧪 Testing Hybrid Memory Persistence...");

    const testId = `TEST-${Date.now()}`;
    const testContent = `Persistence Check: ${testId}`;

    // 1. Store Volatile Memory
    console.log("1️⃣  Storing volatile memory (Ultra-Short)...");
    await continuum.store(testContent, MemoryTier.ULTRA_SHORT, ['test', 'persistence']);

    // 2. Force Snapshot (Simulate Dirty Check)
    // 2. Force Snapshot (Simulate Dirty Check)
    console.log("2️⃣  Forcing Snapshot Save...");

    // Use the newly exposed debug method
    await continuum.forceSave();

    // Small buffer for FS
    console.log("   (Waiting 1s for I/O...)");
    await new Promise(r => setTimeout(r, 1000));

    // 3. Clear RAM (Simulate Crash/Restart)
    console.log("3️⃣  Simulating Crash (Clearing RAM)...");
    // We can't easily "reset" the singleton instance without restarting process, 
    // but we can manually empty the arrays if we access them via 'any'.
    (continuum as any).ultraShort = [];
    (continuum as any).short = [];

    const verifyEmpty = await continuum.getVolatileState();
    if (verifyEmpty.length > 0) {
        console.error("   ❌ Failed to clear RAM. Test invalid.");
        return;
    }
    console.log("   ✅ RAM Cleared. Memory is gone.");

    // 4. Reload from Snapshot (Simulate Reboot)
    console.log("4️⃣  Simulating Reboot (Loading Snapshot)...");
    // loadSnapshot is private, called in constructor.
    // We can call it via cast.
    await (continuum as any).loadSnapshot();

    // 5. Verify Retrieval
    console.log("5️⃣  Verifying Retrieval...");
    const volatile = continuum.getVolatileState();
    const found = volatile.find(n => n.content === testContent);

    if (found) {
        console.log("   ✅ SUCCESS: Persistence Retrieved Memory!");
        console.log(`      - Content: ${found.content}`);
        console.log(`      - Tier: ${found.tier}`);

        // Check Source (Redis vs Disk)
        // We can't know for sure here without logs, but if it works, it works.
        const redisKeys = await redisClient.keys('continuum:volatile');
        if (redisKeys.length > 0) {
            console.log("      - Source: Likely REDIS (Key found)");
        } else {
            console.log("      - Source: DISK (No Redis key found)");
        }
    } else {
        console.error("   ❌ FAILURE: Memory lost during restart.");
    }

    // Cleanup
    process.exit(0);
}

testPersistence();
