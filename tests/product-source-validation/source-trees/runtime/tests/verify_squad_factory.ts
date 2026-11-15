import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { squadFactory } from '../services/factory/squadFactory';

async function runTest() {
    console.log("🧪 Starting SquadFactory Verification...");

    const goal = "launch a viral marketing campaign for a new AI coffee machine";

    try {
        console.log(`\n1. Spawning Squad for goal: "${goal}"`);
        const start = Date.now();

        const squad = await squadFactory.spawnSquad({
            goal: goal,
            budget: 'BALANCED'
        });

        const duration = (Date.now() - start) / 1000;

        console.log("\n============================================");
        console.log(`✅ Squad Spawned in ${duration.toFixed(2)}s`);
        console.log("============================================");
        console.log(`Name: ${squad.name}`);
        console.log(`ID: ${squad.id}`);
        console.log(`Leader: ${squad.leaderId}`);
        console.log("--------------------------------------------");
        console.log("MEMBERS:");
        squad.agents.forEach(a => {
            console.log(`- [${a.roleType}] ${a.name} (${a.role})`);
            console.log(`  Cat: ${a.category} | Tier: ${a.tier}`);
            console.log(`  Caps: ${a.capabilities.slice(0, 3).join(', ')}...`);
            console.log("");
        });

        if (squad.agents.length < 2) throw new Error("Squad too small");
        if (!squad.leaderId) throw new Error("No leader assigned");

        console.log("\n✅ Test Passed!");
        process.exit(0);

    } catch (e) {
        console.error("\n❌ Test Failed:", e);
        process.exit(1);
    }
}

runTest();
