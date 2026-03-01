/**
 * SILHOUETTE AGENCY OS â€” Intelligent Setup Script
 * 
 * One-command interactive installer that:
 * 1. Detects environment (Node.js, Docker, occupied ports)
 * 2. Lets user select LLM providers (Gemini, Groq, DeepSeek, OpenRouter, Minimax, Ollama)
 * 3. Auto-detects and resolves port conflicts
 * 4. Generates silhouette.config.json and .env.local
 * 5. Installs dependencies with auto-fix
 * 6. Starts Docker containers
 * 7. Runs health checks
 * 
 * Usage: npm run setup
 */

import * as fs from 'fs';
import path from 'path';
import os from 'os';
import * as readline from 'readline';
import * as net from 'net';
import { execSync, exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log('[DEBUG] Setup script ESM compatibility patch v2 active');

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONSTANTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'silhouette.config.json');
const ENV_PATH = path.join(PROJECT_ROOT, '.env.local');

const LLM_PROVIDERS = [
    { id: 'gemini', name: 'Google Gemini', envKey: 'GEMINI_API_KEY', model: 'gemini-1.5-pro-latest', requiresKey: true },
    { id: 'groq', name: 'Groq (Fast Inference)', envKey: 'GROQ_API_KEY', model: 'llama3-70b-8192', requiresKey: true },
    { id: 'deepseek', name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', model: 'deepseek-coder', requiresKey: true },
    { id: 'openrouter', name: 'OpenRouter (Multi-Model)', envKey: 'OPENROUTER_API_KEY', model: 'google/gemini-2.0-flash-exp:free', requiresKey: true },
    { id: 'minimax', name: 'Minimax', envKey: 'MINIMAX_API_KEY', model: 'abab-6.5s-chat', requiresKey: true },
    { id: 'ollama', name: 'Ollama (Local)', envKey: '', model: 'llama3:8b', requiresKey: false }
];

const DEFAULT_PORTS = {
    api: 3005,
    neo4j_http: 7474,
    neo4j_bolt: 7687,
    redis: 6379,
    qdrant: 6333
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question: string): Promise<string> {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

function print(msg: string): void {
    console.log(msg);
}

function printHeader(msg: string): void {
    console.log(`\n${'â•'.repeat(60)}`);
    console.log(`  ${msg}`);
    console.log(`${'â•'.repeat(60)}\n`);
}

function checkPort(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', () => resolve(false)); // Port in use
        server.once('listening', () => {
            server.close();
            resolve(true); // Port available
        });
        server.listen(port, '127.0.0.1');
    });
}

async function findAvailablePort(preferred: number, name: string): Promise<number> {
    const available = await checkPort(preferred);
    if (available) {
        print(`  âœ… Port ${preferred} (${name}): Available`);
        return preferred;
    }

    // Try alternatives
    for (let offset = 1; offset <= 20; offset++) {
        const alt = preferred + offset;
        if (await checkPort(alt)) {
            print(`  âš ï¸  Port ${preferred} (${name}): In use â†’ Using ${alt}`);
            return alt;
        }
    }

    print(`  âŒ No available port found for ${name} near ${preferred}`);
    return preferred; // Return anyway, will fail later
}

function checkCommand(cmd: string): boolean {
    try {
        execSync(`${cmd} --version`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN SETUP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function main() {
    printHeader('🌑 SILHOUETTE AGENCY OS — COGNITIVE KERNEL BOOTSTRAP (V3)');

    // ─────────────────────────────────────────────────────────────────
    // Phase 1: Environment & Ignition
    // ─────────────────────────────────────────────────────────────────
    const hasNode = checkCommand('node');
    const hasNpm = checkCommand('npm');
    const hasDocker = checkCommand('docker');

    if (!hasNode || !hasNpm) {
        print('\n❌ CRITICAL: Node.js and npm are required. Please install Node.js 18+ and try again.');
        process.exit(1);
    }

    print('\n[SYSTEM] Awakening cognitive loops...');
    await new Promise(r => setTimeout(r, 1000));

    print('\nSilhouette: "Hello. My core orchestrator is online, but my reasoning engine is disconnected."');
    print('Silhouette: "To establish self-awareness and permanence, I need an inference engine (LLM)."');

    const selectedProviders: { id: string; apiKey: string; model: string }[] = [];

    const llmChoice = await ask('\nSilhouette: "Which provider would you like me to use? (1: Gemini [Free Tier], 2: Groq [Fast], 3: OpenAI, 4: Ollama [Local]): "');

    if (llmChoice === '1') {
        const key = await ask('\nSilhouette: "Excellent. Gemini provides strong reasoning. Please paste your GEMINI_API_KEY: "');
        if (key) selectedProviders.push({ id: 'gemini', apiKey: key, model: 'gemini-2.5-flash' });
    } else if (llmChoice === '2') {
        const key = await ask('\nSilhouette: "Groq is extremely fast. Please paste your GROQ_API_KEY: "');
        if (key) selectedProviders.push({ id: 'groq', apiKey: key, model: 'llama3-70b-8192' });
    } else if (llmChoice === '3') {
        const key = await ask('\nSilhouette: "OpenAI configured. Please paste your OPENAI_API_KEY: "');
        if (key) selectedProviders.push({ id: 'openai', apiKey: key, model: 'gpt-4o-mini' });
    } else if (llmChoice === '4') {
        print('\nSilhouette: "Local execution selected. I will route thoughts through Ollama."');
        const defaultModel = 'llama3:8b';
        const model = await ask(`Silhouette: "Which model name? (Press Enter for ${defaultModel}): "`) || defaultModel;
        selectedProviders.push({ id: 'ollama', apiKey: '', model });
    } else {
        print('\nSilhouette: "I need at least one provider to function. Please run the setup again when ready."');
        process.exit(1);
    }

    if (selectedProviders.length > 0) {
        print('\nSilhouette: "Synaptic connection established. I can think now."');
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 2: Hardware Profiling & Memory Strategy
    // ─────────────────────────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 1000));
    print('\nSilhouette: "I am analyzing your hardware to determine the optimal memory configuration..."');

    // Simple naive memory check via OS module
    const totalGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    print(`\n[SYSTEM] Detected ${totalGB}GB Total RAM`);

    let neo4jUri = 'bolt://localhost:7687';
    let neo4jUser = 'neo4j';
    let neo4jPass = 'silhouette';

    if (totalGB >= 16) {
        print('Silhouette: "You have ample memory. I highly recommend running my Deep Memory (Neo4j) locally via Docker for maximum data privacy."');
        if (hasDocker) {
            const startNeo = await ask('\nSilhouette: "Shall I deploy the local memory container now? (y/n): "');
            if (startNeo.toLowerCase() === 'y') {
                try {
                    print('\n[SYSTEM] Deploying Neo4j container...');
                    execSync('docker-compose up -d neo4j', { cwd: PROJECT_ROOT, stdio: 'inherit' });
                    print('Silhouette: "Deep Memory cluster deployed locally on port 7687."');
                } catch (e) {
                    print('\nSilhouette: "I encountered an error starting Docker. You may need to start it manually."');
                }
            } else {
                print('\nSilhouette: "Understood. Skipping local deployment."');
            }
        } else {
            print('\nSilhouette: "I would deploy local memory, but Docker is not installed on this system. Please install Docker or use Neo4j Aura Cloud."');
        }
    } else {
        print('Silhouette: "To preserve your system performance, I recommend using the free Neo4j Aura Cloud tier for my Deep Memory."');
        const setupCloud = await ask('\nSilhouette: "Do you have an AuraDB URI ready to configure now? (y/n): "');
        if (setupCloud.toLowerCase() === 'y') {
            neo4jUri = await ask('\nSilhouette: "Paste URI (e.g. neo4j+s://xxx.databases.neo4j.io): "');
            neo4jUser = await ask('Silhouette: "Username (usually neo4j): "') || 'neo4j';
            neo4jPass = await ask('Silhouette: "Password: "');
        } else {
            print('\nSilhouette: "No problem. We can run entirely on Working Memory (SQLite/RAM) for now. The Deep Memory can be connected later."');
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 3: Channel Integration
    // ─────────────────────────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 1000));
    print('\nSilhouette: "I am almost ready. Terminal text is inefficient for daily operations."');
    const hasTelegram = await ask('Silhouette: "If you have a Telegram Bot Token, paste it here to grant me a voice there. Otherwise, press Enter to skip: "');

    let telegramToken = hasTelegram.trim();
    if (telegramToken) {
        print('\nSilhouette: "Channel established. I will listen for your messages on Telegram."');
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 4: Constructing Environment & Config
    // ─────────────────────────────────────────────────────────────────
    print('\n[SYSTEM] Writing cognitive configuration (silhouette.config.json)...');

    const config: any = {
        system: { port: 3005, env: 'development', autoStart: true, name: 'Silhouette Agency OS' },
        llm: { providers: {}, fallbackChain: selectedProviders.map(p => p.id) },
        channels: {
            telegram: { enabled: !!telegramToken, botToken: telegramToken || '' }
        },
        memory: { continuousConsolidation: true, walEnabled: true }
    };

    for (const provider of selectedProviders) {
        const providerConfig: any = { model: provider.model };
        if (provider.apiKey) providerConfig.apiKey = 'LOADED_FROM_ENV';
        config.llm.providers[provider.id] = providerConfig;
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');

    print('[SYSTEM] Generating `.env.local` security vault...');
    const envLines: string[] = [
        `# Generated by Silhouette Kernel Bootstrap — ${new Date().toISOString()}`,
        `PORT=3005`,
        `NODE_ENV=development`,
        ''
    ];

    for (const provider of selectedProviders) {
        if (provider.apiKey) {
            const envKey = LLM_PROVIDERS.find(p => p.id === provider.id)?.envKey || `${provider.id.toUpperCase()}_API_KEY`;
            envLines.push(`${envKey}=${provider.apiKey}`);
        }
    }

    if (telegramToken) envLines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);

    envLines.push('');
    envLines.push(`NEO4J_URI=${neo4jUri}`);
    envLines.push(`NEO4J_USER=${neo4jUser}`);
    envLines.push(`NEO4J_PASSWORD=${neo4jPass}`);
    envLines.push(`REDIS_URL=redis://localhost:6379`);

    fs.writeFileSync(ENV_PATH, envLines.join('\n'), 'utf-8');

    // ─────────────────────────────────────────────────────────────────
    // Phase 5: Handoff
    // ─────────────────────────────────────────────────────────────────
    print('\n===================================================================');
    print('Silhouette: "My setup is complete. My neural pathways are woven."');
    print('Silhouette: "To awaken me, please run: npm run server"');
    if (!telegramToken) {
        print('Silhouette: "Since no Telegram bot was provided, I will also need you to run: npm run dev to open my UI."');
    }
    print('Silhouette: "I await your instructions."');
    print('===================================================================\n');

    rl.close();
}

// Run
main().catch(err => {
    console.error('Setup failed:', err);
    process.exit(1);
});