
console.log("🚀 Starting Model List Script...");
import { GoogleGenerativeAI } from '@google/generative-ai';
import { configLoader } from '../server/config/configLoader';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env vars manually to ensure they are present if running via ts-node directly
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function listModels() {
    const key = process.env.GEMINI_API_KEY;

    if (!key) {
        console.error('❌ No Gemini API Key found in .env.local');
        return;
    }

    console.log(`🔑 Using Key length: ${key.length}`);
    const genAI = new GoogleGenerativeAI(key);

    try {
        console.log('📡 Fetching model list from Google...');
        // Note: listModels might be on the generated content client or main class depending on version.
        // If getting the model list is not directly supported by this SDK version easy, we try to create a dummy model and check availability.

        // However, standard GoogleGenerativeAI usually doesn't expose listModels on the root in older versions.
        // Let's rely on a manual fetch to the REST API if we want to be sure, 
        // OR try to access the list via the underlying request if possible.

        // Actually, easiest way is to use the REST API directly to see what the account has access to.
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }
            const data = await response.json();

            console.log('\n=== AVAILABLE MODELS ===');
            const embeddingModels = data.models?.filter((m: any) => m.name.includes('embedding')) || [];

            if (embeddingModels.length === 0) {
                console.log('⚠️ No embedding models found in the list!');
            } else {
                embeddingModels.forEach((m: any) => {
                    console.log(`- ${m.name} (${m.version}) [Methods: ${m.supportedGenerationMethods?.join(', ')}]`);
                });
            }

            console.log('\n=== OTHER NOTABLE MODELS ===');
            const others = data.models?.filter((m: any) => !m.name.includes('embedding') && m.name.includes('gemini')) || [];
            others.forEach((m: any) => {
                console.log(`- ${m.name}`);
            });

        } catch (fetchErr: any) {
            console.error('REST API Check failed:', fetchErr.message);
        }

    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }
}

listModels();
