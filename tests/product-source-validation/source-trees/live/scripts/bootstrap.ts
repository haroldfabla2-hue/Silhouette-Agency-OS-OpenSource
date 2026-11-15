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
        // Only write values the user actually entered: an empty KEY= line in
        // .env.local shadows the real key from .env (dotenv does not override),
        // leaving providers NOT_CONFIGURED even with a valid key in .env.
        const envLines: string[] = [];
        if (geminiKey) envLines.push(`GEMINI_API_KEY=${geminiKey}`);
        if (minimaxKey) envLines.push(`MINIMAX_API_KEY=${minimaxKey}`);
        if (telegramToken) envLines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);
        if (allowedChatIds) envLines.push(`ALLOWED_CHAT_IDS=${allowedChatIds}`);
        fs.writeFileSync(envPath, envLines.join('\n') + '\n');
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
