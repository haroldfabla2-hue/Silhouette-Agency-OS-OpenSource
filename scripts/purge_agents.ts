
import { agentPersistence } from '../services/agentPersistence';

console.log("🔥 Initiating Agent Purge Protocol...");

const allIds = agentPersistence.getAllAgentIds();
console.log(`Found ${allIds.length} agents to purge.`);

if (allIds.length === 0) {
    console.log("System is already clean.");
} else {
    let deletedCount = 0;
    allIds.forEach(id => {
        agentPersistence.deleteAgent(id);
        deletedCount++;
        if (deletedCount % 100 === 0) {
            process.stdout.write('.');
        }
    });

    console.log(`\n✅ Purge Complete. Deleted ${deletedCount} agents.`);
    console.log("Please restart the server to trigger a clean Genesis migration.");
}
