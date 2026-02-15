
import { sqliteService } from '../services/sqliteService';

async function cleanup() {
    console.log("🧹 Starting Drone Cleanup...");

    // 1. Get all agents
    const agents = sqliteService.getAllAgents();
    console.log(`📊 Total Agents: ${agents.length}`);

    // 2. Identify Drones (Pattern: starts with 'drone-')
    const drones = agents.filter(a => a.id.startsWith('drone-'));
    console.log(`🤖 Found ${drones.length} drones to reset.`);

    // 3. Delete them
    let deleted = 0;
    for (const drone of drones) {
        sqliteService.deleteAgent(drone.id);
        deleted++;
        process.stdout.write(`\rDeleted: ${deleted}/${drones.length}`);
    }

    console.log(`\n✅ Cleanup Complete. Removed ${deleted} drones.`);
    console.log("🚀 Restart the server to regenerate them with deterministic IDs.");
}

cleanup().catch(console.error);
