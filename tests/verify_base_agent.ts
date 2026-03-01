import { StandardAgent } from '../services/agents/StandardAgent';
import { AgentStatus, AgentRoleType, AgentTier } from '../types';
import { orchestrator } from '../services/orchestrator';
import { toolRegistry } from '../services/tools/toolRegistry';

async function verifyBaseAgent() {
    console.log("=========================================");
    console.log("   🧪 BASE AGENT NUCLEUS VERIFICATION    ");
    console.log("=========================================");

    // Initialize tools first so the orchestrator can route to them
    await toolRegistry.initialize();

    const testAgent = new StandardAgent({
        id: 'test-agent-01',
        name: 'Test_Nucleus',
        role: 'A synthetic testing agent',
        teamId: 'TEST',
        category: 'DEV',
        roleType: AgentRoleType.WORKER,
        tier: AgentTier.WORKER,
        status: AgentStatus.OFFLINE,
        enabled: true,
        memoryLocation: 'RAM',
        preferredMemory: 'RAM',
        capabilities: [],
        cpuUsage: 0,
        ramUsage: 0,
        lastActive: 0
    });

    // Register with orchestrator so tools can dispatch context
    orchestrator.registerAgent(testAgent.toMetadata());

    console.log("\n[1] Testing Native Thinking Loop...");
    const thought = await testAgent.think("I need to output a simple plan to check the current date/time.");
    console.log("💭 THOUGHT:\n", thought);

    console.log("\n[2] Testing Execution Loop (Tool Invocation)...");
    try {
        const result = await testAgent.executeTask("Find out the current date and time. Do not make assumptions, use a tool or script if necessary to execute code.");
        console.log("✅ FINAL EXECUTION RESULT:\n", result);

        console.log("\n[3] Memory State:");
        console.log(testAgent.thoughtProcess);
    } catch (e) {
        console.error("❌ EXECUTION FAILED:", e);
    }

    process.exit(0);
}

verifyBaseAgent();
