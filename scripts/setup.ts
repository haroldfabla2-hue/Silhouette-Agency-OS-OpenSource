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

    let neo4jUri = 'bolt://127.0.0.1:7787'; // [ROBUSTNESS]: Changed from 7687 to 7787 to match Docker exposed bolt port, and explicitly use 127.0.0.1 for IPv4
    let neo4jUser = 'neo4j';
    let neo4jPass = 'silhouette';

    if (totalGB >= 16) {
        const hasDocker = checkCommand('docker');
        if (hasDocker) {
            const startLocal = await confirm({
                message: 'You have ample memory. Shall I deploy the local Deep Memory (Neo4j) and Event Bus (Redis) containers now?',
                initialValue: true
            });

            if (isCancel(startLocal)) process.exit(0);

            if (startLocal) {
                s.start('Deploying Deep Memory (Neo4j) and Event Bus (Redis) clusters via Docker...');
                try {
                    // [ROBUSTNESS]: Redis is strictly required for BullMQ and PubSub, started natively now.
                    // Pass .env.local to docker-compose so NEO4J_PASSWORD is substituted without injecting all vars into the container.
                    execSync('docker-compose --env-file .env.local up -d neo4j redis', { cwd: PROJECT_ROOT, stdio: 'pipe' });
                    s.stop('Clusters deployed locally (Neo4j: 7687, Redis: 6499).');
                } catch (e: any) {
                    s.stop('⚠️ Failed to start Docker auto-magically.');
                    note(`Please run this manually:\ndocker-compose --env-file .env.local up -d neo4j redis\nError details: ${e.message}`, 'error');
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

    let telegramToken = '';
    let telegramAccessMode = 'allowlist';
    let telegramResponseMode = 'auto-reply';
    let telegramAllowedIds = '';

    const setupTelegram = await confirm({
        message: 'Do you want to configure a Telegram Bot to communicate with Silhouette from your phone?',
        initialValue: false
    });

    if (isCancel(setupTelegram)) process.exit(0);

    if (setupTelegram) {
        telegramToken = await text({
            message: 'Provide your Telegram Bot Token (from @BotFather):',
            placeholder: '123456789:ABCdefGHIjklmNOPqrsTUVwxyz',
            validate(value) {
                if (value.length === 0) return 'Token is required. Leave blank to skip in the previous step.';
            },
        }) as string;

        if (isCancel(telegramToken)) process.exit(0);

        if (telegramToken && telegramToken.length > 10) {
            const securityMode = await select({
                message: 'Choose your Telegram Bot Security Mode (Access):',
                options: [
                    { value: 'auto-trust', label: 'Auto-Trust (Recommended)', hint: 'Binds forever to the first human who messages it.' },
                    { value: 'strict-allowlist', label: 'Strict Allowlist', hint: 'Manually enter your numeric Telegram ID.' },
                    { value: 'open', label: 'Open Access (Insecure)', hint: 'Anyone can use your bot.' }
                ]
            }) as string;

            if (isCancel(securityMode)) process.exit(0);

            if (securityMode === 'strict-allowlist') {
                note('Tip: You can use @userinfobot on Telegram to securely find your numeric ID.');
                telegramAllowedIds = await text({
                    message: 'Enter your numeric Telegram ID (comma-separated if multiple):',
                    placeholder: '123456789',
                    validate(value) {
                        if (value.length === 0) return 'ID is required for Strict Allowlist.';
                    }
                }) as string;
                if (isCancel(telegramAllowedIds)) process.exit(0);
                telegramAccessMode = 'allowlist';
            } else if (securityMode === 'auto-trust') {
                telegramAccessMode = 'allowlist';
                telegramAllowedIds = ''; // Handled dynamically on first boot
            } else if (securityMode === 'open') {
                telegramAccessMode = 'open';
                telegramAllowedIds = '';
            }

            telegramResponseMode = await select({
                message: 'Should the agent automatically reply in Telegram?',
                options: [
                    { value: 'auto-reply', label: 'Auto-Reply', hint: 'Agent actively talks back.' },
                    { value: 'read-only', label: 'Read-Only', hint: 'Agent logs messages silently without responding.' }
                ]
            }) as string;

            if (isCancel(telegramResponseMode)) process.exit(0);
        }
    }

    // --- WHATSAPP CONFIGURATION ---
    let whatsappEnabled = false;
    let whatsappAccessMode = 'allowlist';
    let whatsappResponseMode = 'auto-reply';
    let whatsappAllowedIds = '';

    const setupWhatsapp = await confirm({
        message: 'Do you want to configure WhatsApp (Free Web/QR Mode via Baileys)?',
        initialValue: false
    });

    if (isCancel(setupWhatsapp)) process.exit(0);

    if (setupWhatsapp) {
        whatsappEnabled = true;

        const securityMode = await select({
            message: 'Choose your WhatsApp Security Mode (Access):',
            options: [
                { value: 'auto-trust', label: 'Auto-Trust (Recommended)', hint: 'Binds forever to the first human who messages it.' },
                { value: 'strict-allowlist', label: 'Strict Allowlist', hint: 'Manually enter allowed phone numbers.' },
                { value: 'open', label: 'Open Access (Insecure)', hint: 'Anyone can use your bot.' }
            ]
        }) as string;

        if (isCancel(securityMode)) process.exit(0);

        if (securityMode === 'strict-allowlist') {
            whatsappAllowedIds = await text({
                message: 'Enter allowed phone numbers, including country code (comma-separated):',
                placeholder: '1234567890, 0987654321',
                validate(value) {
                    if (value.length === 0) return 'Number is required for Strict Allowlist.';
                }
            }) as string;
            if (isCancel(whatsappAllowedIds)) process.exit(0);
            whatsappAccessMode = 'allowlist';
        } else if (securityMode === 'auto-trust') {
            whatsappAccessMode = 'allowlist';
            whatsappAllowedIds = '';
        } else if (securityMode === 'open') {
            whatsappAccessMode = 'open';
            whatsappAllowedIds = '';
        }

        whatsappResponseMode = await select({
            message: 'Should the agent automatically reply in WhatsApp?',
            options: [
                { value: 'auto-reply', label: 'Auto-Reply', hint: 'Agent actively talks back.' },
                { value: 'read-only', label: 'Read-Only', hint: 'Agent logs messages silently without responding.' }
            ]
        }) as string;

        if (isCancel(whatsappResponseMode)) process.exit(0);
    }

    // --- DISCORD CONFIGURATION ---
    let discordToken = '';
    let discordAccessMode = 'allowlist';
    let discordResponseMode = 'auto-reply';
    let discordAllowedGuilds = '';
    let discordAllowedChannels = '';

    const setupDiscord = await confirm({
        message: 'Do you want to configure a Discord Bot?',
        initialValue: false
    });

    if (isCancel(setupDiscord)) process.exit(0);

    if (setupDiscord) {
        discordToken = await text({
            message: 'Provide your Discord Bot Token:',
            validate(value) {
                if (value.length === 0) return 'Token is required. Leave blank to skip in the previous step.';
            },
        }) as string;

        if (isCancel(discordToken)) process.exit(0);

        if (discordToken && discordToken.length > 10) {
            const securityMode = await select({
                message: 'Choose your Discord Bot Security Mode (Access):',
                options: [
                    { value: 'strict-allowlist', label: 'Strict Allowlist', hint: 'Restrict by specific Servers (Guilds) or Channels.' },
                    { value: 'open', label: 'Open Access (Insecure)', hint: 'Anyone in any server the bot is in can interact.' }
                ]
            }) as string;

            if (isCancel(securityMode)) process.exit(0);

            if (securityMode === 'strict-allowlist') {
                discordAllowedGuilds = await text({
                    message: 'Enter allowed Guild IDs (comma-separated, leave blank for any if channel restricted):',
                }) as string;
                if (isCancel(discordAllowedGuilds)) process.exit(0);

                discordAllowedChannels = await text({
                    message: 'Enter allowed Channel IDs (comma-separated, leave blank for any if guild restricted):',
                }) as string;
                if (isCancel(discordAllowedChannels)) process.exit(0);

                discordAccessMode = 'allowlist';
            } else if (securityMode === 'open') {
                discordAccessMode = 'open';
            }

            discordResponseMode = await select({
                message: 'Should the agent automatically reply in Discord?',
                options: [
                    { value: 'auto-reply', label: 'Auto-Reply', hint: 'Agent actively talks back.' },
                    { value: 'read-only', label: 'Read-Only', hint: 'Agent logs messages silently without responding.' }
                ]
            }) as string;

            if (isCancel(discordResponseMode)) process.exit(0);
        }
    }


    s.start('Writing configuration to silhouette.config.json and .env.local...');
    const config: any = {
        system: { port: 3005, env: 'development', autoStart: true, name: 'Silhouette Agency OS' },
        llm: { providers: {}, fallbackChain: selectedProviders.map(p => p.id) },
        channels: {
            telegram: {
                enabled: !!telegramToken,
                botToken: telegramToken || '',
                accessMode: telegramAccessMode,
                responseMode: telegramResponseMode,
                allowedIds: telegramAllowedIds ? telegramAllowedIds.split(',').map(id => id.trim()) : []
            },
            whatsapp: {
                enabled: whatsappEnabled,
                sessionPath: './data/whatsapp-session',
                accessMode: whatsappAccessMode,
                responseMode: whatsappResponseMode,
                allowFrom: whatsappAllowedIds ? whatsappAllowedIds.split(',').map(id => id.trim()) : []
            },
            discord: {
                enabled: !!discordToken,
                botToken: discordToken || '',
                accessMode: discordAccessMode,
                responseMode: discordResponseMode,
                allowedGuildIds: discordAllowedGuilds ? discordAllowedGuilds.split(',').map(id => id.trim()) : [],
                allowedChannelIds: discordAllowedChannels ? discordAllowedChannels.split(',').map(id => id.trim()) : []
            }
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

    // Write Telegram ENV
    if (telegramToken && telegramToken.length > 10) {
        envLines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);
        envLines.push(`TELEGRAM_ACCESS_MODE=${telegramAccessMode}`);
        envLines.push(`TELEGRAM_RESPONSE_MODE=${telegramResponseMode}`);
        if (telegramAllowedIds) {
            envLines.push(`TELEGRAM_ALLOWED_IDS=${telegramAllowedIds}`);
        }
    }

    // Write WhatsApp ENV
    envLines.push(`WHATSAPP_ENABLED=${whatsappEnabled}`);
    if (whatsappEnabled) {
        envLines.push(`WHATSAPP_ACCESS_MODE=${whatsappAccessMode}`);
        envLines.push(`WHATSAPP_RESPONSE_MODE=${whatsappResponseMode}`);
        if (whatsappAllowedIds) {
            envLines.push(`WHATSAPP_ALLOWED_IDS=${whatsappAllowedIds}`);
        }
    }

    // Write Discord ENV
    if (discordToken && discordToken.length > 10) {
        envLines.push(`DISCORD_BOT_TOKEN=${discordToken}`);
        envLines.push(`DISCORD_ACCESS_MODE=${discordAccessMode}`);
        envLines.push(`DISCORD_RESPONSE_MODE=${discordResponseMode}`);
        if (discordAllowedGuilds) {
            envLines.push(`DISCORD_ALLOWED_GUILDS=${discordAllowedGuilds}`);
        }
        if (discordAllowedChannels) {
            envLines.push(`DISCORD_ALLOWED_CHANNELS=${discordAllowedChannels}`);
        }
    }
    envLines.push('');
    envLines.push(`NEO4J_URI=${neo4jUri}`);
    envLines.push(`NEO4J_USER=${neo4jUser}`);
    envLines.push(`NEO4J_PASSWORD=${neo4jPass}`);
    envLines.push(`REDIS_URL=redis://127.0.0.1:6499`);

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