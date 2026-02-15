
import { performance } from 'perf_hooks';
import { geminiService } from '../services/geminiService';
import { cfo } from '../services/cfoService';
import { contextAssembler } from '../services/contextAssembler';

async function measure(name: string, fn: () => Promise<any>) {
    const start = performance.now();
    try {
        await fn();
    } catch (e) {
        console.error(`Error in ${name}:`, e);
    }
    const end = performance.now();
    console.log(`[TRACE] ${name}: ${(end - start).toFixed(2)}ms`);
}

async function runTrace() {
    console.log('--- STARTING LATENCY TRACE ---');

    console.log('1. Warmup (Imports)...');

    await measure('CFO Model Negotiation', async () => {
        cfo.negotiateModel('Test task', 'gemini-1.5-flash', { agentName: 'TestAgent', category: 'DEV' });
    });

    await measure('Context Assembly (Global)', async () => {
        await contextAssembler.getGlobalContext('Test task context retrieval');
    });

    // We won't actually call Gemini to save tokens/time, but we traced the pre-calculation steps.
    console.log('--- TRACE COMPLETE ---');
    process.exit(0);
}

runTrace();
