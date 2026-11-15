
import { introspection } from '../services/introspectionEngine';
import { SystemProtocol } from '../types';
import { systemBus } from '../services/systemBus';
import fs from 'fs';
import path from 'path';

// MOCK ORCHESTRATOR & REMEDIATION for test isolation
// In a real run, these are singleton instances, but for this script we assume they work.

async function runTest() {
    try {
        console.log("--- TEST: SELF-CORRECTION (AGENT HEALING) ---");

        // 0. Ensure Technical Debt Service is Listening (Fix Race Condition)
        const { technicalDebt } = await import('../services/technicalDebt');
        console.log("[TEST] Technical Debt Service Active:", !!technicalDebt);

        // 1. Setup a "Broken" Dummy File
        const testFile = path.resolve('services', 'dummy_broken_service.ts');
        await fs.promises.writeFile(testFile, 'export const broken = true; // BUG HERE', 'utf-8');
        console.log("1. Created 'Broken' File:", testFile);

        // 2. Inject a "Orientation" that triggers SELF-CORRECTION
        // We bypass 'observe' and 'orient' to directly test 'decide' -> 'act' pipeline 
        // or we can mock the observation to look like a critical failure.

        // Let's manually trigger the ACT phase for precision testing.
        const decision = {
            requiresIntervention: true,
            priority: 'HIGH',
            proposedAction: {
                type: 'SELF_CORRECTION',
                payload: {
                    file: testFile,
                    content: 'export const broken = false; // FIXED',
                    check: 'Verify broken is false'
                }
            },
            reasoning: "Detected bug in dummy service."
        };

        console.log("2. Forcing Decision (Simulating Intelligent Output)...");
        // We call act directly
        await introspection.act(decision as any);

        // 3. Verify the file changed
        const newContent = await fs.promises.readFile(testFile, 'utf-8');
        console.log("3. Verifying File Content...");

        if (newContent.includes('FIXED') && newContent.includes('false')) {
            console.log("✅ SUCCESS: Agent corrected the file.");
        } else {
            console.error("❌ FAILURE: File was not fixed. Content:", newContent);
        }

        // 4. Verify Technical Debt Recording
        console.log("4. Verifying Technical Debt Log...");
        // Wait briefly for event propagation
        await new Promise(r => setTimeout(r, 500));

        try {
            const { technicalDebt } = await import('../services/technicalDebt');
            const debt = technicalDebt.getActiveDebt();
            console.log("   - Active Debt Items:", debt.length);

            if (debt.length > 0 && debt[0].appliedPatch.includes('FIXED')) {
                console.log("✅ SUCCESS: Incident recorded as Technical Debt.");
                console.log("   - Debt ID:", debt[0].id);
                console.log("   - Status:", debt[0].status);
            } else {
                console.warn("⚠️ WARNING: No debt recorded. Middleware setup issue?");
            }
        } catch (e) {
            console.error("Error checking debt:", e);
        }

        // Cleanup
        await fs.promises.unlink(testFile);
        console.log("5. Cleanup Complete.");

    } catch (error) {
        console.error("❌ Cycle Failed:", error);
    }
}

// Run
runTest();
