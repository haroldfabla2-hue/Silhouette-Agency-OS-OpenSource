
import { agentPersistence } from '../services/agentPersistence';
import { Agent } from '../types';

console.log("🔍 Auditing Squads and Agents...");

const ids = agentPersistence.getAllAgentIds();
console.log(`Total Agents Found: ${ids.length}`);

const squadsMap = new Map<string, number>();

ids.forEach(id => {
    const agent = agentPersistence.loadAgent(id);
    if (agent) {
        const team = agent.teamId || 'UNASSIGNED';
        squadsMap.set(team, (squadsMap.get(team) || 0) + 1);
    }
});

console.log(`Total Unique Squads (by teamId): ${squadsMap.size}`);
console.log("\n--- SQUAD DISTRIBUTION ---");
squadsMap.forEach((count, team) => {
    console.log(`[${team}]: ${count} agents`);
});
