
import { agentRegistry } from '../services/registry/AgentRegistry';
import { AgentProfile } from '../types';

async function verifyRegistry() {
    console.log("🔍 Verifying Agent Registry...");

    try {
        // 1. Load Agents
        console.log("1. Loading agents from disk...");
        await agentRegistry.loadAgents();

        const agents = agentRegistry.getAllAgents();
        console.log(`✅ Loaded ${agents.length} agents.`);

        if (agents.length === 0) {
            console.error("❌ No agents loaded! Expected at least 'orchestrator'.");
            process.exit(1);
        }

        // 2. Verify Orchestrator
        console.log("2. Verifying 'orchestrator' exists...");
        const orchestrator = agentRegistry.getAgent('orchestrator');
        if (orchestrator && orchestrator.name === 'Orchestrator') {
            console.log("✅ Orchestrator found and valid.");
        } else {
            console.error("❌ Orchestrator not found or invalid.");
            process.exit(1);
        }

        // 3. Test Persistence (Save new agent)
        console.log("3. Testing persistence (Create 'TestBot')...");
        const testBot: AgentProfile = {
            id: 'test_bot_v1',
            name: 'Test Bot',
            role: 'Quality Assurance',
            capabilities: ['testing', 'logging'],
            systemPrompt: 'You are a test bot.',
            communicationStyle: 'Binary',
            maxContextWindow: 4096,
            modelPreference: 'MOCK-1'
        };

        await agentRegistry.saveAgent(testBot);

        // Reload to verify it stuck
        await agentRegistry.loadAgents();
        const reloadedBot = agentRegistry.getAgent('test_bot_v1');

        if (reloadedBot) {
            console.log("✅ specific agent 'test_bot_v1' persisted and reloaded successfully.");
        } else {
            console.error("❌ Failed to reload 'test_bot_v1'.");
            process.exit(1);
        }

        console.log("🎉 Agent Registry Verification PASSED.");

    } catch (error) {
        console.error("❌ Verification Failed:", error);
        process.exit(1);
    }
}

verifyRegistry();
