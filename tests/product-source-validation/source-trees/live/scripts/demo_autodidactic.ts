
import { systemBus } from '../services/systemBus';
import { SystemProtocol, AgentRoleType, AgentStatus, AgentTier } from '../types';
import { dataCollector } from '../services/training/dataCollector';
import { continuum } from '../services/continuumMemory';

// MOCK: Researcher_Pro Agent
const RESEARCHER_AGENT = {
    id: 'sci-03',
    name: 'Researcher_Pro',
    role: 'Senior Researcher',
    category: 'SCIENCE'
};

async function runDemo() {
    console.log("\n🧪 STARTING AUTODIDACTIC CYCLE DEMO 🧪\n");

    // 1. Simulate User Query (Ignorance)
    const query = "What is the release date of GPT-5?"; // Something it likely doesn't know strictly
    console.log(`[USER] Question: "${query}"`);
    console.log(`[SILHOUETTE] 🤔 Introspection: "My internal weights do not contain this specific fact."`);

    // 2. Simulate Orchestrator Delegation
    console.log(`[ORCHESTRATOR] 📢 Delegating to ${RESEARCHER_AGENT.name} (Tool: TOOL_WEB_SEARCH)...`);

    // 3. Simulate Agent Research (Tool Execution)
    await new Promise(r => setTimeout(r, 1000));
    const searchResult = "GPT-5 has not been officially released as of late 2024, but OpenAI has hinted at future models. Rumors suggest late 2025.";
    console.log(`[TOOL:WEB_SEARCH] 🔍 Result: "${searchResult}"`);

    // 4. Simulate Learning (Consolidation)
    console.log(`[SILHOUETTE] 💡 Consolidated Answer: "${searchResult}"`);

    // Emit the TRAINING_EXAMPLE_FOUND event manually to test the loop
    // In a real flow, this comes from the ActionExecutor or NarrativeService detecting a high-quality QA pair
    systemBus.emit(SystemProtocol.TRAINING_EXAMPLE_FOUND, {
        input: `User: ${query}`,
        output: `Silhouette: ${searchResult}`,
        score: 0.95, // High confidence = worthy of sleep training
        tags: ['RESEARCH', 'NEW_KNOWLEDGE'],
        source: 'AutodidacticDemo'
    });

    // 5. Verify Capture
    console.log(`[DATA_COLLECTOR] ⏳ Waiting for Hippocampus to process...`);
    await new Promise(r => setTimeout(r, 2000));

    // Force Flush to Disk
    await dataCollector.saveToDisk();
    console.log(`[DEMO] ✅ Cycle Complete. Check 'data/training/dataset.jsonl' for the new synaptic weight candidate.`);

    process.exit(0);
}

runDemo().catch(console.error);
