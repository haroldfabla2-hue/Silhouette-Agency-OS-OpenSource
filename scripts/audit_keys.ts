
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load .env.local manually to ensure we bypass any pre-loaded env
const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const REQUIRED_KEYS = [
    'STABILITY_API_KEY',
    'FREEPIK_API_KEY',
    'FREEPIK_SECRET',
    'VEO_API_KEY', // Check if this exists or if we should use GEMINI_API_KEY
    'UNSPLASH_ACCESS_KEY',
    'UNSPLASH_SECRET_KEY',
    'TAVILY_API_KEY',
    'IMAGINEART_API_KEY',
    'REPLICATE_API_KEY',
    'ELEVENLABS_API_KEY',
    'GROQ_API_KEY',
    'OLLAMA_BASE_URL' // Local model check
];

console.log(`--- API KEY AUDIT FOR ${envPath} ---`);

REQUIRED_KEYS.forEach(key => {
    const value = envConfig[key];
    if (value) {
        console.log(`[OK] ${key}: Present (${value.substring(0, 4)}...${value.substring(value.length - 4)})`);
    } else {
        console.log(`[MISSING] ${key}`);
    }
});

console.log("--- END AUDIT ---");
