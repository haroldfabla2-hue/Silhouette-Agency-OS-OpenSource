
import { minimaxService } from '../services/minimaxService';
import { llmGateway } from '../services/llmGateway';
import { configLoader } from '../server/config/configLoader';

console.log('🧪 Testing Minimax Integration...');

async function runTest() {
    // 1. Verify Config Load
    const config = configLoader.getConfig();
    const hasMinimax = !!(process.env.MINIMAX_API_KEY || config.llm.providers.minimax?.apiKey);
    if (!hasMinimax) {
        console.error('❌ Minimax API Key NOT FOUND in env/config');
        process.exit(1);
    }
    console.log('✅ Config loaded');

    // 2. Direct Service Test
    try {
        console.log('🔄 Testing Service Direct Call...');
        const response = await minimaxService.generateCompletion("Say 'Hello World' in English.");
        console.log('📝 Response:', response);
        if (response.includes('Hello')) {
            console.log('✅ Direct Call Success');
        } else {
            console.warn('⚠️ Unexpected response content');
        }
    } catch (e: any) {
        console.error('❌ Direct Call Failed:', e.message);
    }

    // 3. Gateway Test
    try {
        console.log('🔄 Testing Gateway Routing (Preferred: MINIMAX)...');
        const gwResponse = await llmGateway.complete("What is 2+2?", { preferredProvider: 'MINIMAX' });
        console.log(`📝 Gateway Response [${gwResponse.provider}]:`, gwResponse.text);

        if (gwResponse.provider === 'MINIMAX') {
            console.log('✅ Gateway Routing Success');
        } else {
            console.error(`❌ Gateway routed to ${gwResponse.provider} instead of MINIMAX`);
        }
    } catch (e: any) {
        console.error('❌ Gateway Test Failed:', e.message);
    }
}

runTest();
