
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'db', 'silhouette.sqlite');
const db = new Database(DB_PATH);

console.log("🧹 Cleaning up duplicate chat logs...");

try {
    // Strategy: Keep the row with the lowest ROWID per timestamp group
    const info = db.prepare(`
        DELETE FROM chat_logs 
        WHERE rowid NOT IN (
            SELECT min(rowid)
            FROM chat_logs
            GROUP BY timestamp, content
        )
    `).run();

    console.log(`✅ Removed ${info.changes} duplicate rows.`);

} catch (e: any) {
    console.error("❌ Cleanup failed:", e.message);
} finally {
    db.close();
}
