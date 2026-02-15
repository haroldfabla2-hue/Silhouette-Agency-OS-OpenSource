
import { orchestrator } from '../services/orchestrator';

console.log("--- DEBUG: ORCHESTRATOR STATE ---");

const agents = orchestrator.getAgents();
console.log(`Total Agents: ${agents.length}`);

const squads = orchestrator.getSquads();
console.log(`Total Squads: ${squads.length}`);

if (squads.length > 0) {
    console.log("Sample Squad:", JSON.stringify(squads[0], null, 2));
} else {
    console.log("WARNING: No squads found!");
}

if (agents.length > 0) {
    console.log("Sample Agent:", JSON.stringify(agents[0], null, 2));
} else {
    console.log("WARNING: No agents found!");
}

console.log("--- END DEBUG ---");
