
import { actionExecutor } from '../services/actionExecutor';
import { ActionType } from '../types';
import path from 'path';
import fs from 'fs/promises';

async function verifySelfEvolution() {
    console.log("🧬 Starting Self-Evolution Verification (Shadow Lab Protocol)...");

    const targetFile = path.resolve(process.cwd(), 'SELF_EVOLUTION_TEST.txt');
    const content = `[${new Date().toISOString()}] This file was created by the AI itself to verify write access to the root directory safely.`;

    try {
        // Attempt to write to root (should trigger Git Transaction)
        const result = await actionExecutor.execute({
            type: 'WRITE_FILE',
            agentId: 'tester',
            id: 'test-action-1',
            status: 'PENDING',
            timestamp: Date.now(),
            requiresApproval: false,
            payload: {
                path: targetFile,
                content: content
            }
        } as any);

        if (result.success && result.data.mode === 'GIT_TRANSACTION') {
            console.log("✅ SUCCESS: Git Transaction completed successfully.");
            console.log("   Mode:", result.data.mode);
            console.log("   Verified:", result.data.verified);

            // Verify file exists
            const fileContent = await fs.readFile(targetFile, 'utf-8');
            console.log("   File Content Verified:", fileContent);

            // Cleanup
            await fs.unlink(targetFile);
            console.log("🧹 Cleanup complete.");

        } else if (result.success && result.data.mode === 'SANDBOX') {
            console.error("❌ FAILED: Write fell back to SANDBOX mode (unexpected).");
        } else {
            console.error("❌ FAILED: Transaction failed.", result.error);
        }

    } catch (e) {
        console.error("💥 CRITICAL ERROR:", e);
    }
}

verifySelfEvolution();
