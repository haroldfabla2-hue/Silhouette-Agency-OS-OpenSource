import { promptCompiler } from "../services/promptCompiler";
import { CommunicationLevel } from "../types";

const runTest = () => {
    console.log("--- TESTING PROMPT COMPILER ---");

    // Test 1: User Facing (Donna)
    console.log("\n[TEST 1] LEVEL: USER_FACING");
    const p1 = promptCompiler.compile(CommunicationLevel.USER_FACING, {
        role: "Orchestrator",
        category: "CORE",
        task: "Explain the plan to the user.",
        contextData: "User wants to build a CRM."
    });
    console.log(p1.substring(0, 200) + "...");

    // Test 2: Executive (Diplomat)
    console.log("\n[TEST 2] LEVEL: EXECUTIVE");
    const p2 = promptCompiler.compile(CommunicationLevel.EXECUTIVE, {
        role: "System_Architect",
        category: "INTEGRATION",
        task: "Design the database schema.",
        contextData: "Need high scalability."
    });
    console.log(p2.substring(0, 200) + "...");

    // Test 3: Technical (Robot)
    console.log("\n[TEST 3] LEVEL: TECHNICAL");
    const p3 = promptCompiler.compile(CommunicationLevel.TECHNICAL, {
        role: "Code_Architect",
        category: "DEV",
        task: "Write the SQL migration.",
        contextData: "Table: Users"
    });
    console.log(p3.substring(0, 200) + "...");
};

runTest();
