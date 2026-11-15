import { contextAssembler } from '../services/contextAssembler';
import { continuum } from '../services/continuumMemory';

async function testCompaction() {
    console.log("🚀 Starting Context Compaction & Token Budgeting Test...");

    // 1. Fill session history with junk to exceed budget
    console.log("📝 Filling session history with long messages...");
    for (let i = 0; i < 50; i++) {
        await continuum.store(`Message #${i}: This is a long message to fill the token budget. `.repeat(10), 'SESSION' as any);
    }

    // 2. Fetch context
    console.log("🔍 Fetching global context for task 'Analyze system state'...");
    const context = await contextAssembler.getGlobalContext("Analyze system state");

    // 3. Verify budget
    const budget = context.tokenBudget;
    const items = (context as any).priorityOrder.map((p: any) => p); // Simplified access for test

    // In actual code, it's not exposed like this, but we can check the total result
    console.log(`✅ Total Budget: ${budget.totalBudget}`);

    const historyLength = context.chatHistory.length;
    console.log(`📊 History items returned: ${historyLength}`);

    // Check if history shows truncation
    const hasTruncated = context.chatHistory.some(m => m.content.includes("[truncated]") || m.content.includes("[budget cap reached]"));

    if (hasTruncated) {
        console.log("✅ Success: Compaction/Truncation triggered as expected.");
    } else {
        console.warn("⚠️ Warning: No truncation detected. Budget might be too high or history too small.");
    }

    console.log("🏁 Test Complete.");
}

testCompaction().catch(console.error);
