
import { IntrospectionEngine } from '../services/introspectionEngine';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

// Mock Orchestrator Listener (if server not running, we need to mock the receiver)
// But ideally we run this while server is running? 
// No, this script will run standalone, so it needs to instantiate the Orchestrator or ActionExecutor directly 
// OR simply test the extraction logic + Executor logic independently.

// Let's test the full loop by instantiating the components.
// Note: This won't connect to the "live" server bus, but a local instance.

console.log("🧪 Testing Phase 13: Autonomy Loop");

// 1. Setup
const intro = new IntrospectionEngine();

// Mock Orchestrator's job for the test
import { actionExecutor } from '../services/actionExecutor';

systemBus.subscribe(SystemProtocol.ACTION_INTENT, async (event) => {
    console.log("\n[BUS] 📨 Received ACTION_INTENT:", JSON.stringify(event.payload, null, 2));
    const actions = event.payload.actions;
    for (const action of actions) {
        console.log(`[TEST] Delegating to ActionExecutor...`);
        const result = await actionExecutor.execute(action);
        console.log(`[TEST] Result:`, result);
    }
});

// 2. Inject Thought with Action
const thought = "I should document this test. <action type=\"WRITE_FILE\" path=\"autonomy_test.txt\">Hello Human. I created this file autonomously.</action>";

console.log("\n[TEST] 🧠 Injecting Thought:", thought);
intro.setRecentThoughts([thought]);

// 3. Wait for Async Events
setTimeout(() => {
    console.log("\n[TEST] Test Complete. Checking file system...");
    import('fs').then(fs => {
        if (fs.existsSync('sandbox/autonomy_test.txt')) {
            console.log("✅ SUCCESS: File sandbox/autonomy_test.txt exists!");
            console.log("Content:", fs.readFileSync('sandbox/autonomy_test.txt', 'utf-8'));
        } else {
            console.log("❌ FAILURE: File not created.");
        }
    });
}, 2000);
