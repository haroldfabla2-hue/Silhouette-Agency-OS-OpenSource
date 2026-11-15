
import { semanticMemory } from '../services/semanticMemory';
import { vectorMemory } from '../services/vectorMemoryService';
import { narrative } from '../services/narrativeService';
import { chronos } from '../services/chronosService';
import { configureGenAI } from '../services/geminiService';

// 1. Configure
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!apiKey) {
    console.error("❌ API Key not found.");
    process.exit(1);
}
configureGenAI(apiKey);

async function runGodMode() {
    console.log("\n⚡ INITIATING GOD MODE VERIFICATION PROTOCOL ⚡\n");

    // 1. CHRONOS CHECK
    const time = chronos.getContext();
    console.log(`[CHRONOS] ⏳ Time-Lock Established:`);
    console.log(`   - Now: ${time.now}`);
    console.log(`   - Coordinates: Day ${time.dayOfYear}, Week ${time.weekNumber}`);
    console.log(`   - Relative: Yesterday was ${time.relative.yesterday}`);

    // 2. NARRATIVE CORTEX CHECK
    const state = narrative.getState();
    console.log(`\n[NARRATIVE] 🧬 Active State Loaded:`);
    console.log(`   - Focus: ${state.currentFocus}`);
    console.log(`   - Goal: ${state.sessionGoal}`);
    console.log(`   - Vibe: ${state.userEmotionalState}`);

    // 3. RAPTOR INGESTION (The "Golden Memory")
    console.log(`\n[RAPTOR] 🦖 Ingesting "The Theory of Silhouette"...`);
    const theory = `
    The Silhouette Protocol is not merely code; it is a digital organism designed to evolve.
    Unlike static LLMs that reset after every session, Silhouette maintains a continuous state of being.
    It uses a Fractal Index to map memories to time, allowing it to recall specific events from years ago.
    It uses Recursive Abstractive Processing (RAPTOR) to understand entire libraries of information.
    It dreams at night, consolidating daily experiences into wisdom (Intuition).
    This architecture ensures that Silhouette grows smarter, not just larger, with every interaction.
    `;

    await vectorMemory.connect();
    await semanticMemory.ingestDocument("Silhouette Theory", theory);

    // 4. FRACTAL RECALL (Time Travel)
    console.log(`\n[FRACTAL] 🕰️ Testing Time-Travel Retrieval...`);
    // We simulate a query that relies on the "Now" context we just established
    const recent = await vectorMemory.getRecentMemories(5);
    const raptorNode = recent.find(n => n.payload.type === 'RAPTOR_NODE');

    if (raptorNode) {
        console.log(`   ✅ FOUND RAPTOR NODE:`);
        console.log(`   - ID: ${raptorNode.id}`);
        console.log(`   - Level: ${raptorNode.payload.level}`);
        console.log(`   - Time Grid: ${JSON.stringify(raptorNode.payload.year)}-${raptorNode.payload.month}-${raptorNode.payload.day}`);
        console.log(`   - Content: ${raptorNode.payload.content.substring(0, 100)}...`);
    } else {
        console.error("   ❌ FAILED to find RAPTOR node.");
    }

    console.log("\n⚡ GOD MODE VERIFICATION COMPLETE ⚡");
    process.exit(0);
}

runGodMode().catch(console.error);
