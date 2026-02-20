import { minimaxService } from '../services/minimaxService';
import { configLoader } from '../server/config/configLoader';

async function testMinimax() {
    console.log('Testing Minimax Connection...');
    const config = configLoader.getConfig();

    try {
        const response = await minimaxService.chatCompletion([
            { role: 'user', content: 'Hello, are you online?' }
        ]);
        console.log('Response:', response);
        console.log('✅ Minimax Connection Successful');
    } catch (error) {
        console.error('❌ Minimax Connection Failed:', error);
    }
}

testMinimax();
