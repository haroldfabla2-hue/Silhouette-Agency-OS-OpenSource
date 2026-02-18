import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Use standard ANSI for colors to avoid extra dependencies
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
    gray: "\x1b[90m"
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

async function main() {
    console.clear();
    console.log(`
    ${colors.magenta}${colors.bright}🌑 SILHOUETTE AGENCY OS - SETUP WIZARD v2.0${colors.reset}
    ${colors.gray}==============================================${colors.reset}
    Robustness & Scalability Focus
    ${colors.gray}----------------------------------------------${colors.reset}
    `);

    // 1. Requirement Check
    console.log(`${colors.blue}🔍 Checking system requirements...${colors.reset}`);

    const checks = [
        { name: 'Node.js', cmd: 'node -v' },
        { name: 'npm', cmd: 'npm -v' },
        { name: 'Git', cmd: 'git --version' },
        { name: 'Docker', cmd: 'docker --version', optional: true },
        { name: 'Ollama', cmd: 'ollama --version', optional: true }
    ];

    for (const check of checks) {
        try {
            const version = execSync(check.cmd).toString().trim();
            console.log(`${colors.green}✅ ${check.name}:${colors.reset} ${version}`);
        } catch (e) {
            if (check.optional) {
                console.log(`${colors.yellow}⚠️  ${check.name}:${colors.reset} Not detected (Optional)`);
            } else {
                console.error(`${colors.red}❌ ${check.name}: Not found. This is a REQUIRED dependency.${colors.reset}`);
                process.exit(1);
            }
        }
    }

    // 2. Identity Phase
    console.log(`\n${colors.cyan}👤 Identity & Brand${colors.reset}`);
    const adminName = await question(`  Admin Name ${colors.gray}(default: User)${colors.reset}: `) || "User";
    const agentName = await question(`  Agent Name ${colors.gray}(default: Silhouette)${colors.reset}: `) || "Silhouette";

    // 3. Provider Phase
    console.log(`\n${colors.cyan}🔑 AI Provider Configuration${colors.reset}`);
    console.log(`${colors.gray}  Keys are stored in .env.local (Sanitized/Safe)${colors.reset}\n`);

    const keys: Record<string, string> = {};
    const providers = [
        { id: 'GEMINI_API_KEY', name: 'Google Gemini', help: 'Get it at: https://aistudio.google.com/' },
        { id: 'GROQ_API_KEY', name: 'Groq Cloud', help: 'Get it at: https://console.groq.com/' },
        { id: 'DEEPSEEK_API_KEY', name: 'DeepSeek', help: 'Get it at: https://platform.deepseek.com/' },
        { id: 'ZHIPU_API_KEY', name: 'ZhipuAI (GLM)', help: 'Get it at: https://open.bigmodel.cn/' },
        { id: 'MINIMAX_API_KEY', name: 'Minimax', help: 'Get it at: https://platform.minimaxi.com/' }
    ];

    for (const p of providers) {
        console.log(`${colors.bright}${p.name}${colors.reset}`);
        console.log(`${colors.gray}  ${p.help}${colors.reset}`);
        keys[p.id] = await question(`  ${p.name} API Key: `);
        console.log("");
    }

    // 4. Telegram Phase
    console.log(`${colors.cyan}📲 Outreach Channels${colors.reset}`);
    const telegramToken = await question(`  Telegram Bot Token ${colors.gray}(optional)${colors.reset}: `);
    const chatId = await question(`  Your Chat ID ${colors.gray}(optional, for restricted access)${colors.reset}: `);

    // 5. Build Configuration
    console.log(`\n${colors.blue}💾 Generating configurations...${colors.reset}`);

    const config = {
        system: {
            name: "Silhouette Agency OS",
            version: "2.5.0-v2",
            adminName: adminName,
            port: 3005,
            environment: "development"
        },
        autonomy: {
            agentName: agentName,
            enableNarrative: true,
            enableIntrospection: true,
            defaultProvider: keys['GEMINI_API_KEY'] ? "GEMINI" : "OLLAMA",
            fallbackOrder: ["GEMINI", "GROQ", "DEEPSEEK", "ZHIPUAI", "OLLAMA"]
        },
        modules: {
            graph: true,
            vectorDB: true,
            redis: false,
            browser: true,
            audio: true
        }
    };

    // Save silhouette.config.json
    fs.writeFileSync('silhouette.config.json', JSON.stringify(config, null, 4));
    console.log(`${colors.green}  ✅ Created silhouette.config.json${colors.reset}`);

    // Save .env.local (Sanitized approach)
    let envContent = `# SILHOUETTE AGENCY OS - ENVIRONMENT SECRETS\n\n`;
    for (const [id, value] of Object.entries(keys)) {
        envContent += `${id}=${value}\n`;
    }
    envContent += `\n# Channels\nTELEGRAM_BOT_TOKEN=${telegramToken}\nALLOWED_CHAT_IDS=${chatId}\n`;
    envContent += `\n# System\nLOG_LEVEL=info\nAUTO_SAVE_MEMORIES=true\n`;

    fs.writeFileSync('.env.local', envContent);
    console.log(`${colors.green}  ✅ Created .env.local${colors.reset}`);

    rl.close();

    // 6. Post-Setup Actions
    console.log(`\n${colors.magenta}${colors.bright}==============================================${colors.reset}`);
    console.log(`${colors.red}${colors.bright}⚠️  EXPERIMENTAL ALPHA WARNING${colors.reset}`);
    console.log(`${colors.gray}----------------------------------------------${colors.reset}`);
    console.log(`Silhouette OS is a self-evolving system. It can modify`);
    console.log(`its own code and execute system commands. USE WITH CAUTION.`);
    console.log(`${colors.magenta}${colors.bright}==============================================${colors.reset}\n`);

    const kickstart = await new Promise(resolve => {
        const kickRl = readline.createInterface({ input: process.stdin, output: process.stdout });
        kickRl.question(`${colors.cyan}🚀 Would you like to KICKSTART Silhouette now? (y/n)${colors.reset}: `, (answer) => {
            kickRl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });

    if (kickstart) {
        console.log(`\n${colors.green}🛸 Igniting cognitive engines...${colors.reset}`);
        try {
            // Boot the server in a detached process or just exec it
            // For a simple "start", we'll tell them how or try to run it
            console.log(`${colors.blue}Starting Backend Server...${colors.reset}`);
            // Use spawn to keep it running
            const { spawn } = await import('child_process');
            const child = spawn('npm', ['run', 'server'], {
                detached: true,
                stdio: 'inherit',
                shell: true
            });
            child.unref();

            console.log(`\n${colors.green}✅ Silhouette is waking up!${colors.reset}`);
            console.log(`${colors.gray}Access the dashboard at: http://localhost:5173${colors.reset}`);
            console.log(`${colors.gray}Check your Telegram bot if configured.${colors.reset}`);
        } catch (e) {
            console.error(`${colors.red}Failed to auto-start:${colors.reset}`, e);
        }
    } else {
        console.log(`\n${colors.green}🎉 INITIAL SETUP COMPLETE${colors.reset}`);
        console.log(`To start manually later: ${colors.cyan}npm run server${colors.reset}`);
    }

    console.log(`\n${colors.yellow}Welcome back to the grid, ${adminName}.${colors.reset}\n`);
}

main().catch(err => {
    console.error(`${colors.red}Setup Error:${colors.reset}`, err);
    process.exit(1);
});
