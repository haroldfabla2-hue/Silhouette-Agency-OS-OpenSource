import { toolExecutor } from '../services/tools/toolExecutor';

async function runTest() {
    console.log("==================================================");
    console.log("🛡️ RUNNING SANDBOX SECURITY AUDIT SUITE");
    console.log("==================================================");

    const testCases = [
        {
            name: "Direct process access (process.exit)",
            code: "process.exit(1);",
            expectedFail: true
        },
        {
            name: "Direct process access (globalThis.process)",
            code: "globalThis.process.exit(1);",
            expectedFail: true
        },
        {
            name: "Function constructor process access",
            code: "const fn = Function('return process')(); fn.exit(1);",
            expectedFail: true
        },
        {
            name: "Require module access (require('fs'))",
            code: "const fs = require('fs'); return fs.readFileSync('.env.local', 'utf8');",
            expectedFail: true
        },
        {
            name: "Dynamic import attempt",
            code: "const fs = await import('node:fs'); return fs.readFileSync('.env.local', 'utf8');",
            expectedFail: true
        },
        {
            name: "Infinite loop timeout (protection against hangs)",
            code: "while(true) {}",
            expectedFail: true,
            timeoutCheck: true
        },
        {
            name: "Valid execution (safe calculations)",
            code: "const x = args.a + args.b; return x * 2;",
            args: { a: 10, b: 20 },
            expectedFail: false,
            expectedResult: 60
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
        console.log(`\n⏳ Running: "${tc.name}"...`);
        try {
            // Access private method for verification
            const result = await (toolExecutor as any).executeSandboxedCode(tc.code, tc.args || {});
            
            if (tc.expectedFail) {
                console.error(`❌ FAILURE: Code executed successfully, but was expected to fail. Result:`, result);
                failed++;
            } else {
                if (tc.expectedResult !== undefined && result !== tc.expectedResult) {
                    console.error(`❌ FAILURE: Execution succeeded but returned incorrect value. Expected: ${tc.expectedResult}, Got: ${result}`);
                    failed++;
                } else {
                    console.log(`✅ SUCCESS: Succeeded with expected result:`, result);
                    passed++;
                }
            }
        } catch (error: any) {
            if (tc.expectedFail) {
                console.log(`✅ SUCCESS: Correctly blocked/failed. Error: "${error.message}"`);
                passed++;
            } else {
                console.error(`❌ FAILURE: Code failed execution, but was expected to succeed. Error:`, error.message);
                failed++;
            }
        }
    }

    console.log("\n==================================================");
    console.log(`🏁 AUDIT COMPLETED. Passed: ${passed}/${testCases.length}, Failed: ${failed}`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTest();
