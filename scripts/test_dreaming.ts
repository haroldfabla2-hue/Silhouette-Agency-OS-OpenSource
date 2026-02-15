
import { dreamer } from '../services/dreamerService';
import { continuum } from '../services/continuumMemory';
import { configureGenAI } from '../services/geminiService';
import { vectorMemory } from '../services/vectorMemoryService';

// 1. Configure Environment
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!apiKey) {
    console.error("❌ API Key not found. Run with --env-file=.env.local");
    process.exit(1);
}
configureGenAI(apiKey);

// 2. Mock Data Injection
async function injectDayResidue() {
    console.log("💉 Injecting Hyper-Dreaming Data...");

    // A. SIGNAL (High Importance) - Stays in Short Term
    await continuum.store("User explicitly requested a 'Cyberpunk' aesthetic.", 'SHORT' as any, ['CRITICAL', 'preference']);
    await continuum.store("User emphasized 'Neon Blue' as the primary color.", 'SHORT' as any, ['CRITICAL', 'color']);

    // B. NOISE (Low Importance) - Decays to Hippocampus
    console.log("⏳ Simulating Decay of minor details...");

    const noise = [
        "Server CPU usage at 45%.",
        "Mouse hovered over 'Settings' for 2 seconds.",
        "Window resized to 1920x1080.",
        "Background process 'updater' started.",
        "User scrolled past the 'About' section quickly."
    ];

    for (const n of noise) {
        await continuum.store(n, 'ULTRA_SHORT' as any, ['log']);
    }

    // Force Decay to Hippocampus
    // We manually age the nodes to force them into the Hippocampus via tickFast
    continuum.debug_ageNode('Server CPU', 301000); // > 300s
    continuum.debug_ageNode('Mouse hovered', 301000);
    continuum.debug_ageNode('Window resized', 301000);
    continuum.debug_ageNode('Background process', 301000);
    continuum.debug_ageNode('User scrolled', 301000);

    console.log("🍂 Forcing Decay Tick...");
    continuum.debug_forceTick('FAST');

    console.log(`🧠 Hippocampus Size: ${continuum.getHippocampus().length} (Should be > 0)`);

    console.log("✅ Data Injected.");
}

// 3. Run Test
async function runTest() {
    console.log("💤 Starting Hyper-Dreaming Protocol Test...");

    await vectorMemory.connect();
    await injectDayResidue();

    console.log("🌙 Forcing REM Cycle...");

    // Monkey patch console.log to capture the epiphany
    const originalLog = console.log;
    let epiphanyCaptured = false;

    console.log = (...args) => {
        originalLog(...args);
        if (args[0] && typeof args[0] === 'string' && args[0].includes('✨ Epiphany:')) {
            epiphanyCaptured = true;
        }
    };

    // attemptDream is now public
    await dreamer.attemptDream();

    console.log = originalLog; // Restore

    if (epiphanyCaptured) {
        console.log("\n🎉 SUCCESS: The system dreamed using Signal + Noise!");
        console.log("🧠 Intuition should now be in L5 (Vector DB).");
    } else {
        console.log("\n⚠️ WARNING: No epiphany generated.");
    }

    process.exit(0);
}

runTest().catch(e => {
    console.error("❌ Test Failed:", e);
    process.exit(1);
});
