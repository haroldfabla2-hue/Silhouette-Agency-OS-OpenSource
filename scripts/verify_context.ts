
import { contextAssembler } from '../services/contextAssembler';

async function run() {
    console.log("Fetching Global Context...");
    try {
        const context = await contextAssembler.getGlobalContext("debug query");
        console.log("--- SYSTEM METRICS ---");
        console.log(JSON.stringify(context.systemMetrics, null, 2));

        console.log("\n--- CONTEXT DUMP ---");
        // Print keys only to avoid spam
        console.log(Object.keys(context));

        if (context.systemMetrics.realCpu === undefined) {
            console.error("FAIL: realCpu is missing!");
        } else {
            console.log("SUCCESS: realCpu found:", context.systemMetrics.realCpu);
        }

        if (context.systemMetrics.jsHeapSize === undefined) {
            console.error("FAIL: jsHeapSize is missing!");
        } else {
            console.log("SUCCESS: jsHeapSize found:", context.systemMetrics.jsHeapSize);
        }

        if (context.systemMetrics.vramUsage === undefined) {
            console.error("FAIL: vramUsage is missing!");
        } else {
            console.log("SUCCESS: vramUsage found:", context.systemMetrics.vramUsage);
        }

    } catch (e) {
        console.error("Error fetching context:", e);
    }
    process.exit(0);
}

run();
