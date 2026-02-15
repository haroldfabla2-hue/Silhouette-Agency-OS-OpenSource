
import { generateAgentResponseStream, configureGenAI } from '../services/geminiService';
import { introspection } from '../services/introspectionEngine';
import { IntrospectionLayer, WorkflowStage } from '../types';

// 1. Configure Environment
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!apiKey) {
    console.error("❌ API Key not found. Run with --env-file=.env.local");
    process.exit(1);
}
configureGenAI(apiKey);

// 2. Monkey Patch Introspection to Spy on Updates
const originalSetRecentThoughts = introspection.setRecentThoughts.bind(introspection);
let thoughtUpdateCount = 0;

introspection.setRecentThoughts = (thoughts: string[]) => {
    thoughtUpdateCount++;
    console.log(`\n🧠 [LIVE THOUGHT UPDATE #${thoughtUpdateCount}]:`);
    thoughts.forEach(t => console.log(`   - ${t}`));
    originalSetRecentThoughts(thoughts);
};

// 3. Run Test
async function runTest() {
    console.log("🧪 Starting Live Thought Stream Stress Test...");
    console.log("📝 Prompt: 'Analyze the concept of time travel in 3 distinct steps.'");

    const startTime = Date.now();

    await generateAgentResponseStream(
        "Test_Agent",
        "Philosopher",
        "TEST",
        "Analyze the concept of time travel in 3 distinct steps. For each step, provide a deep philosophical reason.",
        null,
        IntrospectionLayer.DEEP,
        WorkflowStage.EXECUTION,
        [],
        { id: 'test-project', name: 'Test Project' },
        (chunk) => {
            process.stdout.write(chunk); // Stream output to console
        }
    );

    console.log("\n\n✅ Stream Complete.");
    console.log(`⏱️ Duration: ${(Date.now() - startTime) / 1000}s`);
    console.log(`📊 Total Thought Updates: ${thoughtUpdateCount}`);

    if (thoughtUpdateCount > 1) {
        console.log("🎉 SUCCESS: Thoughts were updated incrementally during the stream!");
    } else {
        console.log("⚠️ WARNING: Thoughts only updated once (at the end?). Check logic.");
    }

    process.exit(0);
}

runTest().catch(e => {
    console.error("❌ Test Failed:", e);
    process.exit(1);
});
