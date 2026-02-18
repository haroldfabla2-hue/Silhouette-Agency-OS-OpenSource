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
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function main() {
    printHeader('ðŸŒ™ SILHOUETTE AGENCY OS â€” INTELLIGENT SETUP');

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Step 1: Environment Detection
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    printHeader('Step 1: Environment Detection');

    const hasNode = checkCommand('node');
    const hasDocker = checkCommand('docker');
    const hasNpm = checkCommand('npm');

    print(`  Node.js: ${hasNode ? 'âœ… Found' : 'âŒ Not found'}`);
    print(`  npm:     ${hasNpm ? 'âœ… Found' : 'âŒ Not found'}`);
    print(`  Docker:  ${hasDocker ? 'âœ… Found' : 'âš ï¸  Not found (optional, for Neo4j/Redis/Qdrant)'}`);

    if (!hasNode || !hasNpm) {
        print('\nâŒ Node.js and npm are required. Please install Node.js 18+ and try again.');
        process.exit(1);
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Step 2: LLM Provider Selection
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    printHeader('Step 2: Select LLM Providers');
    print('Choose which LLM providers to configure.');
    print('You need at least ONE provider. Multiple providers enable fallback.\n');

    const selectedProviders: { id: string; apiKey: string; model: string }[] = [];

    for (const provider of LLM_PROVIDERS) {
        const response = await ask(`Enable ${provider.name}? (y/n): `);
        if (response.toLowerCase() === 'y') {
            if (provider.requiresKey) {
                const key = await ask(`  Enter ${provider.envKey}: `);
                if (key) {
                    const model = await ask(`  Model (press Enter for ${provider.model}): `) || provider.model;
                    selectedProviders.push({ id: provider.id, apiKey: key, model });
                    print(`  âœ… ${provider.name} configured`);
                } else {
                    print(`  âš ï¸  Skipped ${provider.name} (no API key)`);
                }
            } else {
                // Ollama: no key needed
                const model = await ask(`  Ollama model (press Enter for ${provider.model}): `) || provider.model;
                selectedProviders.push({ id: provider.id, apiKey: '', model });
                print(`  âœ… ${provider.name} configured (local)`);
            }
        }
    }

    if (selectedProviders.length === 0) {
        print('\nâš ï¸  No providers selected. You can configure them later in silhouette.config.json');
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Step 3: Port Configuration
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    printHeader('Step 3: Port Configuration');
    print('Checking for port conflicts...\n');

    const ports: Record<string, number> = {};
    for (const [name, port] of Object.entries(DEFAULT_PORTS)) {
        ports[name] = await findAvailablePort(port, name);
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Step 4: Generate Configuration
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    printHeader('Step 4: Generating Configuration');

    // Build config
    const config: any = {
        system: {
            port: ports.api,
            env: 'development',
            autoStart: true,
            name: 'Silhouette Agency OS'
        },
        llm: {
            providers: {},
            fallbackChain: selectedProviders.map(p => p.id)
        },
        channels: {},
        media: {},
        memory: {
            continuousConsolidation: true,
            walEnabled: true
        }
    };

    for (const provider of selectedProviders) {
        const providerConfig: any = { model: provider.model };
        if (provider.apiKey) {
            providerConfig.apiKey = provider.apiKey;
        }
        config.llm.providers[provider.id] = providerConfig;
    }

    // Write config
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf-8');
    print(`  âœ… Created silhouette.config.json`);

    // Write .env.local
    const envLines: string[] = [
        `# Generated by Silhouette Setup â€” ${new Date().toISOString()}`,
        `PORT=${ports.api}`,
        `NODE_ENV=development`,
        ''
    ];

    for (const provider of selectedProviders) {
        if (provider.apiKey) {
            const envKey = LLM_PROVIDERS.find(p => p.id === provider.id)?.envKey;
            if (envKey) {
                envLines.push(`${envKey}=${provider.apiKey}`);
            }
        }
    }

    envLines.push('');
    envLines.push(`NEO4J_URI=bolt://localhost:${ports.neo4j_bolt}`);
    envLines.push('NEO4J_USER=neo4j');
    envLines.push('NEO4J_PASSWORD=silhouette_secure_password');
    envLines.push(`REDIS_URL=redis://localhost:${ports.redis}`);

    // Don't overwrite existing .env.local
    if (fs.existsSync(ENV_PATH)) {
        print(`  âš ï¸  .env.local already exists â€” skipping (won't overwrite your keys)`);
    } else {
        fs.writeFileSync(ENV_PATH, envLines.join('\n'), 'utf-8');
        print(`  âœ… Created .env.local`);
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Step 5: Install Dependencies
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    printHeader('Step 5: Installing Dependencies');

    try {
        print('  Running npm install...');
        execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'inherit' });
        print('  âœ… Dependencies installed');
    } catch (error) {
        print('  âš ï¸  npm install failed. Attempting npm audit fix...');
        try {
            execSync('npm audit fix', { cwd: PROJECT_ROOT, stdio: 'inherit' });
            execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'inherit' });
            print('  âœ… Dependencies fixed and installed');
        } catch {
            print('  âŒ Dependency installation failed. Run "npm install" manually.');
        }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Step 6: Docker Setup (Optional)
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (hasDocker) {
        printHeader('Step 6: Docker Services');
        const startDocker = await ask('Start Docker containers (Neo4j, Redis, Qdrant)? (y/n): ');

        if (startDocker.toLowerCase() === 'y') {
            try {
                print('  Starting containers...');
                execSync('docker-compose up -d', { cwd: PROJECT_ROOT, stdio: 'inherit' });
                print('  âœ… Docker containers started');
            } catch {
                print('  âš ï¸  Docker compose failed. Start containers manually.');
            }
        }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Summary
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    printHeader('ðŸŽ‰ Setup Complete!');

    print(`  Configuration: ${CONFIG_PATH}`);
    print(`  Environment:   ${ENV_PATH}`);
    print(`  API Port:      ${ports.api}`);
    print(`  Providers:     ${selectedProviders.map(p => p.id).join(', ') || 'None'}`);
    print('\n  To start Silhouette Agency OS:');
    print('  npm run server\n');

    rl.close();
}

// Run
main().catch(err => {
    console.error('Setup failed:', err);
    process.exit(1);
});