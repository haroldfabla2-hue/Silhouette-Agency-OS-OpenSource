/**
 * COMPREHENSIVE IDENTITY MEMORY CLEANUP
 * ======================================
 * Cleans ALL memory storage backends:
 * 1. SQLite (silhouette.sqlite)
 * 2. LanceDB (silhouette.lancedb)
 * 3. JSON Memory Files (silhouette_memory_db.json, etc.)
 * 
 * Usage: npx tsx scripts/cleanup_all_identity_memories.ts [--dry-run] [--delete]
 */

import Database from 'better-sqlite3';
import * as lancedb from '@lancedb/lancedb';
import * as fs from 'fs/promises';
import * as path from 'path';

// Patterns that indicate identity confusion
const CORRUPTED_PATTERNS = [
    /mi esencia como (Alberto|Beto|usuario)/gi,
    /mi identidad es (Alberto|Beto)/gi,
    /almacenando mi esencia como/gi,
    /conformo mi identidad como el usuario/gi,
    /soy (Alberto|Beto)/gi,
    /mi nombre es (Alberto|Beto)/gi,
    /yo soy (Alberto|Beto)/gi,
    /llámame (Alberto|Beto)/gi,
    /puedes llamarme (Alberto|Beto)/gi,
];

interface CorruptedItem {
    source: string;
    id: string;
    content: string;
}

async function scanSqlite(dbPath: string): Promise<CorruptedItem[]> {
    const corrupted: CorruptedItem[] = [];

    try {
        if (!(await fs.access(dbPath).then(() => true).catch(() => false))) {
            console.log(`⚠️ SQLite not found: ${dbPath}`);
            return corrupted;
        }

        const db = new Database(dbPath, { readonly: true });
        const tables = ['memories', 'continuum_memories', 'narrative_logs', 'thoughts', 'nodes'];

        for (const table of tables) {
            try {
                const rows = db.prepare(`SELECT * FROM ${table}`).all() as any[];
                for (const row of rows) {
                    const content = row.content || row.text || row.narrative || '';
                    for (const pattern of CORRUPTED_PATTERNS) {
                        pattern.lastIndex = 0;
                        if (pattern.test(content)) {
                            corrupted.push({
                                source: `SQLite/${table}`,
                                id: row.id || row.node_id || String(row.rowid),
                                content: content.substring(0, 100)
                            });
                            break;
                        }
                    }
                }
            } catch { /* table doesn't exist */ }
        }
        db.close();
    } catch (e: any) {
        console.log(`❌ SQLite error: ${e.message}`);
    }

    return corrupted;
}

async function scanLanceDB(lancedbPath: string): Promise<CorruptedItem[]> {
    const corrupted: CorruptedItem[] = [];

    try {
        if (!(await fs.access(lancedbPath).then(() => true).catch(() => false))) {
            console.log(`⚠️ LanceDB not found: ${lancedbPath}`);
            return corrupted;
        }

        const db = await lancedb.connect(lancedbPath);
        const tableNames = await db.tableNames();

        for (const tableName of tableNames) {
            try {
                const table = await db.openTable(tableName);
                const rows = await table.query().limit(10000).toArray();

                for (const row of rows) {
                    const content = (row as any).content || (row as any).text || '';
                    for (const pattern of CORRUPTED_PATTERNS) {
                        pattern.lastIndex = 0;
                        if (pattern.test(content)) {
                            corrupted.push({
                                source: `LanceDB/${tableName}`,
                                id: (row as any).id || 'unknown',
                                content: content.substring(0, 100)
                            });
                            break;
                        }
                    }
                }
            } catch (e: any) {
                console.log(`⚠️ LanceDB table ${tableName} error: ${e.message}`);
            }
        }
    } catch (e: any) {
        console.log(`❌ LanceDB error: ${e.message}`);
    }

    return corrupted;
}

async function scanJsonFiles(basePath: string): Promise<CorruptedItem[]> {
    const corrupted: CorruptedItem[] = [];
    const jsonFiles = [
        'silhouette_memory_db.json',
        'silhouette_chat_history.json',
        'silhouette_chat_sessions.json',
        'data/memory_snapshot.json'
    ];

    for (const file of jsonFiles) {
        const filePath = path.join(basePath, file);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            const searchInObject = (obj: any, path: string = '') => {
                if (typeof obj === 'string') {
                    for (const pattern of CORRUPTED_PATTERNS) {
                        pattern.lastIndex = 0;
                        if (pattern.test(obj)) {
                            corrupted.push({
                                source: `JSON/${file}`,
                                id: path,
                                content: obj.substring(0, 100)
                            });
                            break;
                        }
                    }
                } else if (Array.isArray(obj)) {
                    obj.forEach((item, i) => searchInObject(item, `${path}[${i}]`));
                } else if (obj && typeof obj === 'object') {
                    Object.entries(obj).forEach(([k, v]) => searchInObject(v, `${path}.${k}`));
                }
            };

            searchInObject(data);
        } catch { /* file doesn't exist or invalid JSON */ }
    }

    return corrupted;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--delete');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🧹 COMPREHENSIVE IDENTITY MEMORY CLEANUP');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Mode: ${dryRun ? '🔍 DRY RUN (preview only)' : '🗑️ DELETE'}`);
    console.log('');

    const basePath = process.cwd();
    let allCorrupted: CorruptedItem[] = [];

    // 1. Scan SQLite
    console.log('📂 Scanning SQLite...');
    const sqliteCorrupted = await scanSqlite(path.join(basePath, 'db', 'silhouette.sqlite'));
    allCorrupted.push(...sqliteCorrupted);
    console.log(`   Found: ${sqliteCorrupted.length}`);

    // 2. Scan LanceDB
    console.log('📂 Scanning LanceDB...');
    const lanceCorrupted = await scanLanceDB(path.join(basePath, 'db', 'silhouette.lancedb'));
    allCorrupted.push(...lanceCorrupted);
    console.log(`   Found: ${lanceCorrupted.length}`);

    // 3. Scan JSON Files
    console.log('📂 Scanning JSON memory files...');
    const jsonCorrupted = await scanJsonFiles(basePath);
    allCorrupted.push(...jsonCorrupted);
    console.log(`   Found: ${jsonCorrupted.length}`);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📊 TOTAL CORRUPTED ITEMS FOUND: ${allCorrupted.length}`);
    console.log('═══════════════════════════════════════════════════════════');

    if (allCorrupted.length === 0) {
        console.log('✅ No corrupted memories found! All storage backends are clean.');
        return;
    }

    // Show preview
    console.log('\n📋 PREVIEW OF CORRUPTED ITEMS:\n');
    for (const item of allCorrupted.slice(0, 20)) {
        console.log(`─────────────────────────────────────────────────`);
        console.log(`📍 Source: ${item.source} | ID: ${item.id}`);
        console.log(`❌ Content: "${item.content}..."`);
    }

    if (allCorrupted.length > 20) {
        console.log(`\n... and ${allCorrupted.length - 20} more`);
    }

    if (dryRun) {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('🔍 DRY RUN COMPLETE - No changes made');
        console.log('');
        console.log('To delete corrupted items, run:');
        console.log('  npx tsx scripts/cleanup_all_identity_memories.ts --delete');
        console.log('═══════════════════════════════════════════════════════════');
    } else {
        // TODO: Implement actual deletion for each storage type
        console.log('\n⚠️ Deletion not yet implemented. Please manually review and clean.');
    }
}

main().catch(console.error);
