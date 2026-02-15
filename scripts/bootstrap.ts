import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

async function main() {
    console.log(`
    🌑 SILHOUETTE AGENCY OS - SETUP WIZARD
    ======================================
    Creator: Harold Fabla
    License: MIT
    --------------------------------------
    `);

    // 1. Check Requirements
    console.log("🔍 Checking system requirements...");
    try {
        const nodeVersion = process.version;
        console.log(`✅ Node.js: ${nodeVersion}`);

        try {
            execSync('npm --version');
            console.log("✅ npm: Found");
        } catch (e) {
            console.error("❌ npm: Not found. Please install npm.");
            process.exit(1);
        }
    } catch (e) {
        console.error("❌ System check failed.");
        process.exit(1);
    }

    // 2. Interactive Config
    console.log("\n⚙️  Configuration Phase");
    const adminName = await question("What is your name (Admin)? ") || "User";
    const agentName = await question("What name should Silhouette use for herself? ") || "Silhouette";
    const geminiKey = await question("Gemini API Key (optional, press enter to skip): ");
    const minimaxKey = await question("Minimax API Key (optional, press enter to skip): ");
    const telegramToken = await question("Telegram Bot Token (optional): ");
    const allowedChatIds = await question("Allowed Telegram Chat IDs (comma separated, e.g. 123456,789012): ");

    const defaultConfig = {
        system: {
            name: "Silhouette Agency OS",
            version: "2.1",
            adminName: adminName,
            port: 3005
        },
        autonomy: {
            agentName: agentName,
            enableNarrative: true,
            enableIntrospection: true,
            defaultProvider: geminiKey ? "gemini" : "minimax"
        },
        modules: {
            graph: true,
            vectorDB: true,
            redis: false,
            browser: true
        }
    };

    const configPath = path.join(process.cwd(), 'silhouette.config.json');
    const envPath = path.join(process.cwd(), '.env.local');

    // 3. Save Configuration
    console.log("\n💾 Saving configuration...");
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4));
    console.log(`✅ Created ${path.basename(configPath)}`);

    if (!fs.existsSync(envPath)) {
        let envContent = `GEMINI_API_KEY=${geminiKey}\nMINIMAX_API_KEY=${minimaxKey}\n`;
        envContent += `TELEGRAM_BOT_TOKEN=${telegramToken}\n`;
        envContent += `ALLOWED_CHAT_IDS=${allowedChatIds}\n`;
        envContent += `GITHUB_TOKEN=\nGITHUB_REPO_OWNER=\nGITHUB_REPO_NAME=\n`;
        fs.writeFileSync(envPath, envContent);
        console.log(`✅ Created basic ${path.basename(envPath)}`);
    } else {
        console.log(`ℹ️  ${path.basename(envPath)} already exists. Update your keys manually if needed.`);
    }

    // 4. Attribution Verification
    console.log("\n🛡️  Identity Integrity");
    console.log("Implementing 'Kernel of Gratitud'...");
    console.log("✅ Creator Attribution Fixed: Harold Fabla");

    console.log(`
    ======================================
    🎉 SETUP COMPLETE
    ======================================
    To start your agency:
    1. npm install
    2. npm run dev
    
    Welcome to the future of autonomy, ${adminName}.
    `);
    rl.close();
}

main().catch(console.error);
