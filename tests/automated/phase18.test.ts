import { browserService } from '../../services/browserService';
import { selfHealingTask } from '../../services/daemon/selfHealingTask';
import { logger } from '../../services/logger';

async function verifyPhase18() {
    console.log("---- BROWSER TEST ----");
    try {
        const title = await browserService.goto('https://example.com');
        console.log("Browser Loaded Title:", title);

        const text = await browserService.extractText();
        console.log("Browser Extracted Text (First 100 chars):", text.substring(0, 100).replace(/\n/g, ' '));

        await browserService.close();
        console.log("✅ Playwright Browser test passed.");
    } catch (e: any) {
        console.error("❌ Playwright Browser test failed:", e.message);
    }

    console.log("\n---- SELF-HEALING KERNEL TEST ----");
    try {
        // Synthetically trigger an error in the logger to populate system_errors.log
        logger.error({ test_flag: true }, "Test simulated error to trigger self-healing");

        // Let it flush
        await new Promise(r => setTimeout(r, 1000));

        console.log("Triggering self-healing task manually...");
        await selfHealingTask.execute();
        console.log("✅ Self-Healing task execution completed (check logs to see if Orchestrator was invoked).");
    } catch (e: any) {
        console.error("❌ Self-Healing task failed:", e.message);
    }

    process.exit(0);
}

verifyPhase18();
