/**
 * SILHOUETTE AGENCY OS — Intelligent Setup Script
 * 
 * One-command interactive installer using @clack/prompts
 */

import * as fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { intro, outro, confirm, select, multiselect, spinner, isCancel, cancel, text, password, note } from '@clack/prompts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log('[DEBUG] Setup script ESM compatibility patch v2 active');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'silhouette.config.json');
const ENV_PATH = path.join(PROJECT_ROOT, '.env.local');

const LLM_PROVIDERS = [
    { id: 'gemini', name: 'Google Gemini (Free/Paid)', envKey: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', requiresKey: true },
    { id: 'groq', name: 'Groq (Fast Inference)', envKey: 'GROQ_API_KEY', model: 'llama3-70b-8192', requiresKey: true },
    { id: 'openai', name: 'OpenAI', envKey: 'OPENAI_API_KEY', model: 'gpt-4o-mini', requiresKey: true },
    { id: 'deepseek', name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', model: 'deepseek-coder', requiresKey: true },
    { id: 'openrouter', name: 'OpenRouter (Multi-Model Routing)', envKey: 'OPENROUTER_API_KEY', model: 'google/gemini-2.0-flash-exp:free', requiresKey: true },
    { id: 'minimax', name: 'Minimax (Native Audio/Vision)', envKey: 'MINIMAX_API_KEY', model: 'abab-6.5s-chat', requiresKey: true },
    { id: 'ollama', name: 'Ollama (Local Offline)', envKey: '', model: 'llama3:8b', requiresKey: false }
];

function checkCommand(cmd: string): boolean {
    try {
        execSync(`${cmd} --version`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    console.clear();
    intro('🌑 SILHOUETTE AGENCY OS — COGNITIVE KERNEL BOOTSTRAP (V4) 🌑');

    note(
        'Silhouette OS is an experimental autonomous agent framework.\n' +
        'By proceeding, you understand that granting AI agents access to your local file system, terminal, and APIs carries INHERENT DANGERS.\n' +
        'Do NOT run this on a production server without proper sandboxing.',
        '⚠️ SECURITY DISCLAIMER & RISK WARNING'
    );

    const consent = await confirm({
        message: 'Do you fully understand the risks and wish to proceed?',
        initialValue: false
    });

    if (isCancel(consent) || !consent) {
        cancel('Setup aborted. Safety first.');
        process.exit(0);
    }

    const s = spinner();
    s.start('Awakening cognitive loops...');
    await new Promise(r => setTimeout(r, 1000));
    s.stop('Cognitive loops awakened.');

    const selectedProviderIds = await multiselect({
        message: '[CORE] Which LLM providers would you like me to use? (Press Space to select, Enter to confirm)',
        options: LLM_PROVIDERS.map(p => ({ value: p.id, label: p.name })),
        required: true,
    });

    if (isCancel(selectedProviderIds)) {
        cancel('Setup aborted.');
        process.exit(0);
    }

    const selectedProviders: { id: string; apiKey: string; model: string }[] = [];

    // Prompt for keys for each selected provider
    for (const id of selectedProviderIds as string[]) {
        const providerDef = LLM_PROVIDERS.find(p => p.id === id)!;
        let apiKey = '';
        let model = providerDef.model;

        if (providerDef.requiresKey) {
            const keyResult = await password({
                message: `Please paste your ${providerDef.envKey} for ${providerDef.name}:`,
                mask: '*'
            });
            if (isCancel(keyResult)) {
                cancel('Setup aborted.');
                process.exit(0);
            }
            apiKey = keyResult as string;
        } else if (id === 'ollama') {
            const modelResult = await text({
                message: 'Which Ollama model name?',
                initialValue: 'llama3:8b',
                placeholder: 'llama3:8b'
            });
            if (isCancel(modelResult)) {
                cancel('Setup aborted.');
                process.exit(0);
            }
            model = modelResult as string || 'llama3:8b';
        }

        selectedProviders.push({ id, apiKey, model });
    }

    s.start('Analyzing hardware for optimal memory configuration...');
    const totalGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    await new Promise(r => setTimeout(r, 1000));
    s.stop(`Hardware Analysis Complete: ${totalGB}GB Total RAM detected.`);

    let neo4jUri = 'bolt://localhost:7687';
    let neo4jUser = 'neo4j';
    let neo4jPass = 'silhouette';

    if (totalGB >= 16) {
        const hasDocker = checkCommand('docker');
        if (hasDocker) {
            const startNeo = await confirm({
                message: 'You have ample memory. Shall I deploy the local Deep Memory (Neo4j) container now?',
                initialValue: true
            });

            if (isCancel(startNeo)) process.exit(0);

            if (startNeo) {
                s.start('Deploying Neo4j container...');
                try {
                    execSync('docker-compose up -d neo4j', { cwd: PROJECT_ROOT, stdio: 'pipe' });
                    s.stop('Deep Memory cluster deployed locally on port 7687.');
                } catch (e) {
                    s.stop('Failed to start Docker container. You may need to start it manually.');
                }
            }
        } else {
            note('I would deploy local memory, but Docker is not installed on this system. Please install Docker or use Neo4j Aura Cloud.', 'Info');
        }
    } else {
        const setupCloud = await confirm({
            message: 'To preserve performance, I recommend Neo4j Aura Cloud. Do you have an AuraDB URI ready to configure?',
            initialValue: false
        });

        if (isCancel(setupCloud)) process.exit(0);

        if (setupCloud) {
            const uriInput = await text({ message: 'Paste URI (e.g. neo4j+s://xxx.databases.neo4j.io):', validate: v => v.length > 0 ? undefined : 'Required' });
            if (isCancel(uriInput)) process.exit(0);
            neo4jUri = uriInput as string;

            const userInput = await text({ message: 'Username:', initialValue: 'neo4j' });
            if (isCancel(userInput)) process.exit(0);
            neo4jUser = userInput as string;

            const passInput = await password({ message: 'Password:', mask: '*' });
            if (isCancel(passInput)) process.exit(0);
            neo4jPass = passInput as string;
        }
    }

    const telegramInput = await password({
        message: 'If you have a Telegram Bot Token, paste it here to grant me a voice there (Press Enter to skip):',
        mask: '*'
    });

    if (isCancel(telegramInput)) process.exit(0);
    const telegramToken = (telegramInput as string).trim();

    s.start('Writing configuration to silhouette.config.json and .env.local...');
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
    s.stop('Configuration vault generated successfully.');

    let finalMessage = 'My setup is complete. To awaken me, run: npm run boot\n';
    if (!telegramToken) {
        finalMessage += 'Since no Telegram bot was provided, you will interact with me via the UI.\n';
    }
    finalMessage += 'I await your instructions.';

    outro(finalMessage);
}

main().catch(err => {
    console.error('Setup failed:', err);
    process.exit(1);
});