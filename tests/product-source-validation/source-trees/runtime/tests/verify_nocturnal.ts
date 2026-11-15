
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';
import { dataCollector } from '../services/training/dataCollector';
import { dreamer } from '../services/dreamerService'; // Import to init it
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log("=== VERIFYING NOCTURNAL PLASTICITY (PHASE 1) ===");

    // 1. Test Sleep Detection
    console.log("\n[TEST 1] Sleep Detection Logic...");
    try {
        const canSleep = await dreamer.checkSleepConditions();
        console.log(`> Result: ${canSleep ? '✅ Ready to Dream (Idle)' : 'ℹ️ System Busy / Not Idle'}`);
    } catch (e) {
        console.error("> ❌ Sleep check failed:", e);
    }

    // 2. Test Data Collector
    console.log("\n[TEST 2] Data Collector (Hippocampus)...");
    const testPayload = {
        input: "Test Input",
        output: "Test Output",
        score: 0.99,
        tags: ["TEST"],
        source: "VerificationScript"
    };

    console.log("> Emitting 5 training examples to trigger flush...");

    // Emit 5 events to trigger flush
    for (let i = 0; i < 5; i++) {
        systemBus.emit(SystemProtocol.TRAINING_EXAMPLE_FOUND, { ...testPayload, input: `Test Event ${i}` }, "TestScript");
    }

    // Give it a moment to flush
    await new Promise(r => setTimeout(r, 1500));

    const filePath = dataCollector.getDatasetPath();
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        // We look for our specific events
        if (content.includes("Test Event 4")) {
            console.log("> ✅ Data flushed to disk successfully.");
            console.log(`> File path: ${filePath}`);
            console.log(`> Content Preview: ${content.substring(0, 100)}...`);
        } else {
            console.error("> ❌ File exists but content seems missing.");
            console.log("Content:", content);
        }
    } else {
        console.error("> ❌ Data file not created.");
    }

    console.log("\n=== VERIFICATION COMPLETE ===");
    process.exit(0);
}

verify();
