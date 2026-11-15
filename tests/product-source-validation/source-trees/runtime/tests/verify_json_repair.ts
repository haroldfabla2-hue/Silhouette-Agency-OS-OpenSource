
// Mocking the logic directly from the service to verify the algorithm
// This ensures we test the LOGIC without needing to spin up the full service dependency tree

function extractJson(output: string) {
    let jsonStr = output.trim();
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        return null; // Test script returns null on failure for assertion
    }
}

const testCases = [
    {
        name: "Clean JSON",
        input: '{"nodes": [], "edges": []}',
        expected: true
    },
    {
        name: "Markdown Code Block",
        input: '```json\n{"nodes": [{"id":"1"}], "edges": []}\n```',
        expected: true
    },
    {
        name: "Conversational Preamble",
        input: '**SILHOUETTE**\nHere is the graph:\n{"nodes": [{"id":"1"}], "edges": []}',
        expected: true
    },
    {
        name: "Complex Nested + Text",
        input: 'Thinking...\n```json\n{\n  "nodes": [\n    {"id": "1"}\n  ],\n  "edges": []\n}\n```\nHope this helps!',
        expected: true
    },
    {
        name: "Invalid JSON",
        input: 'This is just text with no json',
        expected: false
    }
];

console.log("🔍 Starting JSON Repair Verification...\n");

let passed = 0;
for (const test of testCases) {
    const result = extractJson(test.input);
    const isSuccess = result !== null;

    // We expect success (true) or failure (false)
    if (isSuccess === test.expected) {
        console.log(`✅ MATCH: ${test.name}`);
        passed++;
    } else {
        console.error(`❌ FAIL: ${test.name}`);
        console.error(`   Input: ${test.input.substring(0, 50)}...`);
        console.error(`   Result: ${JSON.stringify(result)}`);
    }
}

console.log(`\nResults: ${passed}/${testCases.length} assertions passed.`);
if (passed === testCases.length) {
    console.log("✨ VERIFICATION SUCCESSFUL ✨");
    process.exit(0);
} else {
    console.error("⚠️ VERIFICATION FAILED");
    process.exit(1);
}
