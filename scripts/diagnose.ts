
import fs from 'fs';
import path from 'path';

const GENESIS_DB_FILE = path.join(process.cwd(), 'db', 'silhouette_genesis_db.json');
const ENV_FILE = path.join(process.cwd(), '.env.local');

console.log("=== SILHOUETTE SYSTEM DIAGNOSTIC ===");
console.log(`Time: ${new Date().toISOString()}`);
console.log(`CWD: ${process.cwd()}`);

// 1. Check .env.local
console.log("\n[1] CHECKING .env.local");
if (fs.existsSync(ENV_FILE)) {
    console.log("✅ .env.local found.");
    const envContent = fs.readFileSync(ENV_FILE, 'utf-8');
    const lines = envContent.split('\n');
    lines.forEach(line => {
        if (line.trim().startsWith('#') || line.trim() === '') return;
        const [key, ...valParts] = line.split('=');
        const val = valParts.join('=');
        if (key && val) {
            console.log(`   - ${key.trim()}: ${val.trim().substring(0, 5)}... (Length: ${val.trim().length})`);
        }
    });
} else {
    console.error("❌ .env.local NOT FOUND!");
}

// 2. Check Process Env (Simulating what Node sees if loaded)
// Note: This script might not have loaded .env.local automatically unless run with --env-file
console.log("\n[2] CHECKING PROCESS.ENV (Current Runtime)");
const keysToCheck = [
    'GEMINI_API_KEY', 'UNSPLASH_ACCESS_KEY', 'REPLICATE_API_TOKEN',
    'ELEVENLABS_API_KEY', 'IMAGINE_ART_KEY', 'TAVILY_API_KEY'
];
keysToCheck.forEach(k => {
    const val = process.env[k];
    if (val) {
        console.log(`   - ${k}: ✅ Loaded (${val.substring(0, 5)}...)`);
    } else {
        console.log(`   - ${k}: ❌ Missing in process.env`);
    }
});

// 3. Check Persistence DB
console.log("\n[3] CHECKING GENESIS DB");
if (fs.existsSync(GENESIS_DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(GENESIS_DB_FILE, 'utf-8'));
        console.log("✅ DB Loaded.");
        const config = data.config || {};

        console.log("   [Persisted Config]:");
        console.log(`   - systemApiKey: ${config.systemApiKey ? '✅ Present' : '❌ Empty'}`);
        console.log(`   - unsplashKey: ${config.unsplashKey ? '✅ Present' : '❌ Empty'}`);
        console.log(`   - tavilyKey: ${config.tavilyKey ? '✅ Present' : '❌ Empty'}`);

        if (config.mediaConfig) {
            console.log(`   - mediaConfig.openaiKey: ${config.mediaConfig.openaiKey ? '✅ Present' : '❌ Empty'}`);
            console.log(`   - mediaConfig.elevenLabsKey: ${config.mediaConfig.elevenLabsKey ? '✅ Present' : '❌ Empty'}`);
            console.log(`   - mediaConfig.replicateKey: ${config.mediaConfig.replicateKey ? '✅ Present' : '❌ Empty'}`);
            console.log(`   - mediaConfig.imagineArtKey: ${config.mediaConfig.imagineArtKey ? '✅ Present' : '❌ Empty'}`);
        } else {
            console.log("   - mediaConfig: ❌ Missing");
        }

    } catch (e) {
        console.error("❌ Error reading DB:", e);
    }
} else {
    console.log("⚠️ Genesis DB file not found (Fresh install?)");
}

console.log("\n=== DIAGNOSTIC COMPLETE ===");
