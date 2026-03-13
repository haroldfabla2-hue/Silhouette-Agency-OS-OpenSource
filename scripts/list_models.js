
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');

async function listModels() {
    const logFile = path.join(__dirname, 'models_list.txt');
    const log = (msg) => {
        console.log(msg);
        fs.appendFileSync(logFile, msg + '\n');
    };

    fs.writeFileSync(logFile, "🚀 Starting Model List Script (File Mode)...\n");

    // Use environment variable for API key
    const key = process.env.GOOGLE_API_KEY;

    if (!key) {
        log('❌ No Gemini API Key found');
        return;
    }

    log(`🔑 Key injected (length: ${key.length})`);

    // Safety timeout
    const timeout = setTimeout(() => {
        log("⏰ Operation timed out!");
        process.exit(1);
    }, 10000);

    try {
        // Direct REST API call
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
        log(`📡 Fetching from: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        const data = await response.json();

        log('\n=== AVAILABLE MODELS ===');
        const embeddingModels = data.models?.filter(m => m.name.includes('embedding')) || [];

        if (embeddingModels.length === 0) {
            log('⚠️ No embedding models found!');
        } else {
            embeddingModels.forEach(m => {
                log(`- ${m.name}`);
            });
        }

        log('\n=== OTHER MODELS ===');
        const otherModels = data.models?.filter(m => !m.name.includes('embedding')) || [];
        otherModels.slice(0, 5).forEach(m => log(`- ${m.name}`));

        clearTimeout(timeout);

    } catch (error) {
        log('❌ Error: ' + error.message);
        clearTimeout(timeout);
    }
}

listModels();
