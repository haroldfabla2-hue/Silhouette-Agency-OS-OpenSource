
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

async function test() {
    const log = (msg) => fs.appendFileSync('diagnosis_log.txt', msg + '\n');
    fs.writeFileSync('diagnosis_log.txt', '--- DIAGNOSIS START ---\n');

    const key = "AIzaSyDXGN4AR3owdj00YXJMLhcErm5H4MePQUQ";
    const genAI = new GoogleGenerativeAI(key);
    const model004 = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const model001 = genAI.getGenerativeModel({ model: "embedding-001" });

    log("Testing text-embedding-004...");
    try {
        await model004.embedContent("test");
        log("✅ text-embedding-004: SUCCESS (Available)");
    } catch (e) {
        log(`❌ text-embedding-004: FAILED (${e.message})`);
    }

    log("\nTesting embedding-001...");
    try {
        await model001.embedContent("test");
        log("✅ embedding-001: SUCCESS (Available)");
    } catch (e) {
        log(`❌ embedding-001: FAILED (${e.message})`);
    }
}

test();
