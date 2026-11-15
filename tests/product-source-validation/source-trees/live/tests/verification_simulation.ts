
// --- MOCK ENVIRONMENT ---
// Polyfill localStorage for Node.js environment
if (typeof global.localStorage === 'undefined') {
    global.localStorage = {
        getItem: () => null,
        setItem: () => { },
        removeItem: () => { },
        clear: () => { },
        length: 0,
        key: () => null
    } as any;
}

// Mock SystemBus to avoid Redis connection
import { SystemProtocol } from '../types';
const mockBusEmit = (protocol: any, payload: any) => {
    console.log(`[BUS] Emitted ${protocol}:`, JSON.stringify(payload).substring(0, 100) + "...");
};

// Mock Orchestrator to avoid complex dependencies
const mockOrchestrator = {
    hydrateAgent: (id: string) => console.log(`[ORCHESTRATOR] ⚡ Waking up agent: ${id}`),
    activeActors: new Map()
};

// --- IMPORTS ---
// We need to use 'require' or dynamic imports to mock modules before they load, 
// but since we are using TSX, we can rely on the fact that we are mocking the *dependencies* 
// of the classes we are testing, or we can just instantiate them and overwrite their dependencies if they were injected.
// However, our services are Singletons. This makes testing hard without a DI container.
// We will use a "Test Wrapper" approach where we manually overwrite the singletons' internal state or methods if possible.

// Actually, let's just import the classes.
// We need to mock 'settingsManager' BEFORE 'cfoService' uses it? 
// No, 'cfoService' imports 'settingsManager' instance. We can modify that instance.

import { cfo } from '../services/cfoService';
import { settingsManager } from '../services/settingsManager';
import { remediation } from '../services/remediationService';
import { orchestrator } from '../services/orchestrator';
import { systemBus } from '../services/systemBus';

// --- SETUP MOCKS ---
// Overwrite SystemBus emit
systemBus.emit = mockBusEmit as any;

// Overwrite Orchestrator methods
(orchestrator as any).hydrateAgent = mockOrchestrator.hydrateAgent;

// --- TEST SUITE ---

async function runTests() {
    console.log("=== 🧪 STARTING SILHOUETTE LOGIC VERIFICATION 🧪 ===\n");

    // TEST 1: CFO API AWARENESS
    console.log("--- TEST 1: CFO API AWARENESS ---");

    // Scenario A: OpenAI is MISSING
    console.log("\n[Scenario A] User asks for GPT-4, but OpenAI Key is MISSING.");
    // Force settings state
    (settingsManager as any).state = {
        registeredIntegrations: [
            { id: 'openai', isConnected: false }, // Disconnected
            { id: 'anthropic', isConnected: false }
        ]
    };

    let model = cfo.negotiateModel("Write complex code", "gpt-4", {});
    console.log(`Result: ${model} (Expected: gemini-1.5-pro due to fallback)`);
    if (model === 'gemini-1.5-pro') console.log("✅ PASS"); else console.error("❌ FAIL");

    // Scenario B: OpenAI is PRESENT
    console.log("\n[Scenario B] User asks for GPT-4, and OpenAI Key is PRESENT.");
    (settingsManager as any).state = {
        registeredIntegrations: [
            { id: 'openai', isConnected: true }, // Connected
            { id: 'anthropic', isConnected: false }
        ]
    };

    model = cfo.negotiateModel("Write complex code", "gpt-4", {});
    console.log(`Result: ${model} (Expected: gpt-4)`);
    if (model === 'gpt-4') console.log("✅ PASS"); else console.error("❌ FAIL");

    // Scenario C: Simple Task Downgrade
    console.log("\n[Scenario C] User asks for GPT-4, but task is SIMPLE.");
    model = cfo.negotiateModel("Hi", "gpt-4", {});
    console.log(`Result: ${model} (Expected: gemini-1.5-flash due to cost saving)`);
    if (model === 'gemini-1.5-flash') console.log("✅ PASS"); else console.error("❌ FAIL");


    // TEST 2: SQUAD REMEDIATION
    console.log("\n--- TEST 2: SQUAD REMEDIATION ---");
    console.log("[Scenario] Agent 'worker-01' enters Infinite Loop.");

    // Mock generateAgentResponse for the Diagnosis step (since we have no credits)
    // We need to mock the import in 'remediationService'. 
    // Since we can't easily mock imports in this script without a framework like Jest,
    // we will rely on the fact that 'remediationService' calls 'orchestrator.hydrateAgent' BEFORE calling the LLM.
    // We will see the hydration logs. The script will likely fail at the LLM call, but that proves the mobilization started.

    try {
        // We expect this to throw or hang because of the real LLM call, so we wrap it.
        // Actually, we can overwrite the 'runDiagnosis' method of remediation service to mock the LLM part!
        (remediation as any).runDiagnosis = async () => {
            console.log("[MOCK] QA Squad analyzed logs. Diagnosis: Logic Loop.");
            return { rootCause: "Logic Loop", fixProposal: "Add break condition", isCriticalApiMissing: false };
        };

        await remediation.mobilizeSquad('worker-01', ['Error: Stack Overflow', 'Repeating output']);
        console.log("✅ PASS: Squad Mobilization completed without crashing.");
    } catch (e) {
        console.error("❌ FAIL: Remediation crashed", e);
    }

    console.log("\n=== 🏁 VERIFICATION COMPLETE 🏁 ===");
}

runTests();
