
import { orchestrator } from '../services/orchestrator';
import { introspection } from '../services/introspectionEngine';
import { AgentStatus } from '../types';

async function verifyZombieProtocol() {
    console.log("🧟 STARTING ZOMBIE PROTOCOL VERIFICATION...");

    // 1. Setup: Hydrate an agent to make it active
    const agentId = 'qa-01';
    console.log(`[SETUP] Hydrating ${agentId}...`);
    await orchestrator.hydrateAgent(agentId);

    // 2. Hack: Artificially age the agent to make it a zombie
    const agent = (orchestrator as any).activeActors.get(agentId);
    if (!agent) {
        console.error("❌ Failed to hydrate agent for test.");
        process.exit(1);
    }

    console.log(`[SETUP] Agent ${agentId} is currently: ${agent.status}`);

    // Make it a ZOMBIE
    agent.status = AgentStatus.WORKING;
    agent.lastActive = Date.now() - (10 * 60 * 1000); // 10 minutes ago
    console.log(`[HACK] Artificial Zombie State induced: Last Active = ${new Date(agent.lastActive).toISOString()}`);

    // 3. Trigger Introspection Observation
    console.log("[TEST] Triggering Introspection...");

    // We mock the cycle to just check observe()
    // Since observe is private/protected or part of the cycle, we might need to access it 
    // OR we can just check the property that contains the logic if it was extracted.
    // In introspectionEngine.ts, the zombie check is inside `observe()`.

    // Note: observe is private in IntrospectionEngine class? Let's check.
    // Ideally we'd run `orchestrateOneCycle` but that does a lot.
    // Let's try to access `observe` via 'any' casting if it's private, or assume it's part of the flow.

    try {
        const observation = await (introspection as any).observe();
        console.log("[RESULT] Observation Result:", JSON.stringify(observation, null, 2));

        const errors = observation.recentErrors || [];
        const foundZombieError = errors.some((e: string) => e.includes("ZOMBIE_OUTBREAK"));

        if (foundZombieError) {
            console.log("✅ SUCCESS: Zombie Outbreak DETECTED by Introspection Engine.");

            // Optional: Check if Remediation was triggered? 
            // The actual triggering happens in DECIDE/ACT phase, but detection is the hard part here.

            // Let's Clean up
            console.log("[CLEANUP] Resetting agent...");
            await orchestrator.resetAgent(agentId);

        } else {
            console.error("❌ FAILURE: Zombie was NOT detected.");
            process.exit(1);
        }

    } catch (e) {
        console.error("❌ TEST FAILED with Exception:", e);
        process.exit(1);
    }
}

verifyZombieProtocol().then(() => {
    console.log("🧟 ZOMBIE PROTOCOL VERIFIED.");
    process.exit(0);
});
