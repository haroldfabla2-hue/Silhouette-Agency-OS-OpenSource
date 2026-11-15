
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'db', 'silhouette.sqlite');

console.log(`
---------------------------------------------------
🔍 SYSTEM INTEGRITY CHECK & VERIFICATION
---------------------------------------------------
Target DB: ${DB_PATH}
`);

if (!fs.existsSync(DB_PATH)) {
    console.error("❌ CRITICAL: Database file not found!");
    process.exit(1);
}

const db = new Database(DB_PATH);

try {
    // 1. CHECK TABLES & COUNTS
    console.log("📊 Checking Table Counts...");
    const tables = ['system_config', 'chat_logs', 'ui_state', 'cost_metrics', 'agents'];

    tables.forEach(table => {
        try {
            const row: any = db.prepare(`SELECT count(*) as count FROM ${table}`).get();
            console.log(`   ✅ Table '${table}': ${row.count} records found.`);
        } catch (e) {
            console.log(`   ⚠️ Table '${table}' missing or empty.`);
        }
    });

    // 2. CHECK SPECIFIC CONFIG KEYS
    console.log("\n🔑 Verifying Critical Config...");
    const configKeys = ['genesisConfig', 'systemApiKey', 'mediaConfig'];
    configKeys.forEach(key => {
        const row: any = db.prepare("SELECT value FROM system_config WHERE key = ?").get(key);
        if (row) {
            const val = JSON.parse(row.value);
            console.log(`   ✅ Key '${key}' exists.`);
            if (key === 'genesisConfig') console.log(`      -> Workspace: ${val.workspaceRoot}`);
        } else {
            console.log(`   ❌ Key '${key}' NOT found in DB.`);
        }
    });

    // 3. CHECK FOR DUPLICATES IN CHAT LOBS
    console.log("\n💬 Checking for Duplicate Chat Logs...");
    // A primitive check: timestamps that are exactly the same
    const dupCheck: any = db.prepare(`
        SELECT timestamp, count(*) as c 
        FROM chat_logs 
        GROUP BY timestamp 
        HAVING c > 1
    `).all();

    if (dupCheck.length > 0) {
        console.log(`   ⚠️ Found ${dupCheck.length} potential duplicate message timestamps.`);
        console.log("   (This is common if migration ran twice. Not critical, but good to know.)");
    } else {
        console.log("   ✅ No duplicate timestamps found.");
    }

    console.log("\n---------------------------------------------------");
    console.log("✅ VERIFICATION COMPLETE");
    console.log("---------------------------------------------------");

} catch (e: any) {
    console.error("❌ ERROR during verification:", e.message);
} finally {
    db.close();
}
