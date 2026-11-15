
import { GoogleGenerativeAI } from '@google/generative-ai';
import { configLoader } from '../server/config/configLoader';

async function listModels() {
    const config = configLoader.getConfig();
    const apiKey = config.llm.providers.gemini.apiKey;

    if (!apiKey) {
        console.error('No Gemini API Key found.');
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    console.log('Fetching available models...');

    try {
        // Accessing the model list directly might require a different approach depending on the SDK version
        // But let's try a standard request if the SDK doesn't expose listModels cleanly on the root.
        // Actually, for the JS SDK, we might need to use the REST API for listing if the SDK wrapper is minimal.
        // Let's try to verify if the model exists by try-catch on the embedding model specifically.

        const modelsToCheck = ['text-embedding-004', 'models/text-embedding-004', 'embedding-001', 'models/embedding-001'];

        for (const modelName of modelsToCheck) {
            console.log(`Checking ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.embedContent("Hello world");
                console.log(`✅ ${modelName} is WORKING.`);
                return; // Found one!
            } catch (e: any) {
                console.log(`❌ ${modelName} failed: ${e.message}`);
            }
        }

    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
