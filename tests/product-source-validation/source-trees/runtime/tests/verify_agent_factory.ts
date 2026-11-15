import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { agentFactory } from '../services/factory/AgentFactory';

async function testFactory() {
    console.log("🏭 Testing Agent Factory Architect...");

    // Mock a Blueprint for a complex agent
    const blueprint = {
        roleName: "Quantum_Debugger",
        description: "An expert in debugging distributed quantum states and race conditions.",
        category: 'DEV' as any, // Using 'DEV' directly as AgentCategory is a type, not an Enum value
        skills: ["Debugging", "Concurrency", "Quantum Physics", "Node.js"]
    };

    try {
        const agentDef = await agentFactory.architectAgent(blueprint);

        console.log("✅ Agent Architected Successfully!");
        console.log("--- DEFINITION ---");
        console.log(JSON.stringify(agentDef, null, 2));

        if (!agentDef.systemInstruction || agentDef.systemInstruction.length < 50) {
            console.error("❌ System Instruction is too short or missing.");
        }

        if (!agentDef.metadata.sources || agentDef.metadata.sources.length === 0) {
            console.warn("⚠️ No sources used. Knowledge library might be empty or search failed.");
        } else {
            console.log(`📚 Sources Used: ${agentDef.metadata.sources.length}`);
        }

    } catch (e) {
        console.error("❌ Factory Failed:", e);
    }
}

testFactory();
