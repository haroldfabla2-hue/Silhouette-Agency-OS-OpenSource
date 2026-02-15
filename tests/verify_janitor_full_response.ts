
import dotenv from 'dotenv';
import { SystemProtocol } from '../types';
import { systemBus } from '../services/systemBus';
import path from 'path';
import fs from 'fs';

// 1. Dynamic Load of Env Vars (ESM Safe)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('[TEST] ✅ Loaded .env.local');
} else {
    console.warn('[TEST] ⚠️ .env.local not found. LLM calls might fail.');
}

// 2. Import Services (Dynamic to ensure Env is loaded first)
async function runTest() {
    const { contextJanitor } = await import('../services/contextJanitor');
    const { continuum } = await import('../services/continuumMemory');
    // Importing orchestrator triggers the subscription to DATA_CORRUPTION
    await import('../services/orchestrator');

    console.log('[TEST] 🎭 Services Initialized. Orchestrator is listening.');

    // 3. Mock Continuum to return corrupt data
    // @ts-ignore
    continuum.getAllNodes = async () => {
        return {
            ultraShort: [
                { id: 'corrupt-node-X', content: undefined, tier: 'ULTRA_SHORT' } as any
            ]
        };
    };

    // 4. Listen for the FINAL RESOLUTION
    systemBus.subscribe(SystemProtocol.UI_REFRESH, (event) => {
        if (event.payload.source === 'REMEDIATION') {
            console.log('\n\n---------------------------------------------------');
            console.log('[TEST] 🎉 FULL AUTONOMY VERIFIED!');
            console.log(`[TEST] 🤖 AGENT RESPONSE: ${event.payload.message}`);
            console.log('---------------------------------------------------\n');
            process.exit(0);
        }
    });

    // 5. Trigger the event chain
    console.log('[TEST] 🧹 Triggering Janitor Scan...');
    await contextJanitor.runMaintenance();

    // 6. Timeout safety
    setTimeout(() => {
        console.error('[TEST] ❌ Timeout: Agents took too long to respond.');
        process.exit(1);
    }, 60000); // 60s timeout for LLM thinking
}

runTest().catch(console.error);
