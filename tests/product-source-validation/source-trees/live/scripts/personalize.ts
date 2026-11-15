/**
 * PERSONALIZATION WIZARD
 * Allows the user to name and configure their Silhouette instance.
 * Updates the core agent's IDENTITY.md and SOUL.md.
 */

import readline from 'readline';
import { agentFileSystem } from '../services/agents/agentFileSystem';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
};

async function main() {
    console.log('\n✨ SILHOUETTE AGENCY OS — PERSONALIZATION WIZARD ✨\n');
    console.log('Let\'s give your AI a unique identity.\n');

    // 1. Name
    const name = await ask('1. What should we call your primary agent? (Default: Silhouette): ') || 'Silhouette';

    // 2. Personality
    console.log('\n2. Describe the personality (e.g., "Professional, witty, and precise" or "Creative, empathetic, and verbose").');
    const personality = await ask('   Personality: ') || 'Professional, helpful, and highly capable assistant.';

    // 3. Greeting
    console.log('\n3. How should it greet you? (Use {name} for your name if you want)');
    const greeting = await ask('   Greeting: ') || `Hello! I am ${name}, your intelligent agency operating system. How can I assist you today?`;

    // 4. Style
    console.log('\n4. Communication Style (e.g., "Concise and direct" or "Detailed and explanatory").');
    const style = await ask('   Style: ') || 'Clear, structured, and informative.';

    console.log(`\nConfiguring ${name}...\n`);

    try {
        // Ensure the directory exists first (in case it's a fresh install)
        const agentId = 'core-01'; // The main manager agent
        if (!agentFileSystem.agentDirExists(agentId)) {
            // If completely fresh, we might need to bootstrap or wait for first run.
            // But usually setup runs before this.
            console.warn(`[WARNING] Agent directory for ${agentId} not found. Ensure you ran 'npm run setup:intelligent' first.`);
        } else {
            agentFileSystem.personalizeAgent(agentId, name, personality, greeting, style);
            console.log('✅ Identity updated successfully!');
            console.log(`\nYour agent is now "${name}". Start the server with 'npm run dev' to meet them.`);
        }
    } catch (error) {
        console.error('❌ Failed to personalize agent:', error);
    }

    rl.close();
}

main();
