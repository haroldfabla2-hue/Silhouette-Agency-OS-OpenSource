
import { configLoader } from '../server/config/configLoader';
import fs from 'fs';
import path from 'path';

console.log('🔍 Verifying Configuration Migration...');

// 1. Trigger Loader (should create file)
const config = configLoader.getConfig();

const configPath = path.join(process.cwd(), 'silhouette.config.json');

// 2. Check File Existence
if (fs.existsSync(configPath)) {
    console.log('✅ silhouette.config.json exists');
} else {
    console.error('❌ of silhouette.config.json MISSING');
    process.exit(1);
}

// 3. Check Key Migration
let checksPassed = true;

if (config.llm.providers.gemini?.apiKey && config.llm.providers.gemini.apiKey !== '') {
    console.log('✅ GEMINI_API_KEY migrated');
} else {
    console.error('❌ GEMINI_API_KEY missing or empty');
    checksPassed = false;
}

if (config.system.port === 3005) {
    console.log('✅ PORT migrated (or default)');
}

if (config.channels.telegram?.enabled) {
    console.log('✅ Telegram enabled (if env present)');
}

// 4. Output Result
if (checksPassed) {
    console.log('🎉 MIGRATION SUCCESSFUL');
    process.exit(0);
} else {
    console.error('⚠️ MIGRATION HAD ISSUES');
    process.exit(1);
}
