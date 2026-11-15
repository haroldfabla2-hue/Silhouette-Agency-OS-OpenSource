
import { sqliteService } from '../services/sqliteService';

async function auditAgents() {
    console.log("🔍 Starting Agent Audit...");

    // 1. Get all agents
    const agents = sqliteService.getAllAgents();
    console.log(`📊 Total Agents in DB: ${agents.length}`);

    // 2. Group by Role
    const roleCounts: Record<string, number> = {};
    const nameCounts: Record<string, number> = {};
    const duplicates: string[] = [];

    agents.forEach(a => {
        roleCounts[a.role] = (roleCounts[a.role] || 0) + 1;
        nameCounts[a.name] = (nameCounts[a.name] || 0) + 1;
    });

    // 3. Display Breakdown
    console.log("\n--- Agents by Role ---");
    const sortedRoles = Object.entries(roleCounts).sort(([, a], [, b]) => b - a);
    sortedRoles.forEach(([role, count]) => {
        if (count > 1) console.log(`${role}: ${count}`);
    });

    console.log("\n--- Potential Duplicates (Same Name) ---");
    const sortedNames = Object.entries(nameCounts).sort(([, a], [, b]) => b - a);
    let dupCount = 0;
    sortedNames.forEach(([name, count]) => {
        if (count > 1) {
            console.log(`${name}: ${count}`);
            dupCount++;
        }
    });

    if (dupCount === 0) console.log("✅ No exact name duplicates found.");

    // 4. Analyze Drones specifically
    const dronePattern = /^drone-/;
    const drones = agents.filter(a => dronePattern.test(a.id));
    console.log(`\n🤖 Total 'Drone' Agents (ID starts with 'drone-'): ${drones.length}`);

    if (drones.length > 0) {
        console.log("ℹ️ Recommendation: Run cleanup script if these seem excessive.");
    }
}

auditAgents().catch(console.error);
