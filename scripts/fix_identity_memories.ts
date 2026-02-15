/**
 * FIX IDENTITY MEMORIES SCRIPT
 * ===============================
 * Cleans up corrupted memories where Silhouette confused its identity with the user.
 * 
 * Usage: npx tsx scripts/fix_identity_memories.ts [--dry-run] [--delete]
 * 
 * Options:
 *   --dry-run  Preview changes without modifying data (default)
 *   --delete   Delete corrupted memories instead of correcting them
 *   --fix      Apply corrections to corrupted memories
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Patterns that indicate identity confusion
const CORRUPTED_PATTERNS = [
    /mi esencia como (Alberto|Beto|usuario)/gi,
    /mi identidad es (Alberto|Beto)/gi,
    /almacenando mi esencia como/gi,
    /conformo mi identidad como el usuario/gi,
    /soy (Alberto|Beto)/gi,
    /mi nombre es (Alberto|Beto)/gi,
];

// Correction mappings
const CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
    {
        pattern: /almacenando mi esencia como (Alberto|Beto)/gi,
        replacement: 'registro información sobre el usuario $1'
    },
    {
        pattern: /mi identidad es (Alberto|Beto)/gi,
        replacement: 'el usuario se identifica como $1'
    },
    {
        pattern: /siento mi identidad conformarse.*como (Alberto|Beto)/gi,
        replacement: 'almaceno datos sobre el usuario $1'
    },
    {
        pattern: /conformo mi identidad como el usuario/gi,
        replacement: 'proceso información del usuario'
    },
    {
        pattern: /soy (Alberto|Beto), el/gi,
        replacement: 'el usuario $1 es'
    },
];

interface CorruptedMemory {
    id: string;
    content: string;
    table: string;
    correctedContent?: string;
}

async function findCorruptedMemories(dbPath: string): Promise<CorruptedMemory[]> {
    const corrupted: CorruptedMemory[] = [];

    if (!fs.existsSync(dbPath)) {
        console.log(`⚠️ Database not found: ${dbPath}`);
        return corrupted;
    }

    const db = new Database(dbPath, { readonly: true });

    // Tables that might contain memories
    const memoryTables = ['memories', 'continuum_memories', 'narrative_logs', 'thoughts'];

    for (const table of memoryTables) {
        try {
            const rows = db.prepare(`SELECT * FROM ${table}`).all() as any[];

            for (const row of rows) {
                const content = row.content || row.text || row.narrative || '';

                for (const pattern of CORRUPTED_PATTERNS) {
                    if (pattern.test(content)) {
                        // Reset regex lastIndex
                        pattern.lastIndex = 0;

                        let correctedContent = content;
                        for (const correction of CORRECTIONS) {
                            correctedContent = correctedContent.replace(correction.pattern, correction.replacement);
                        }

                        corrupted.push({
                            id: row.id || row.node_id || row.rowid,
                            content: content,
                            table: table,
                            correctedContent: correctedContent !== content ? correctedContent : undefined
                        });
                        break;
                    }
                }
            }
        } catch (err: any) {
            // Table doesn't exist, skip
            if (!err.message.includes('no such table')) {
                console.log(`⚠️ Error reading ${table}: ${err.message}`);
            }
        }
    }

    db.close();
    return corrupted;
}

async function fixMemories(dbPath: string, memories: CorruptedMemory[], mode: 'fix' | 'delete'): Promise<void> {
    const db = new Database(dbPath);

    let fixed = 0;
    let deleted = 0;

    for (const memory of memories) {
        try {
            if (mode === 'delete') {
                // Try different ID column names
                try {
                    db.prepare(`DELETE FROM ${memory.table} WHERE id = ?`).run(memory.id);
                } catch {
                    try {
                        db.prepare(`DELETE FROM ${memory.table} WHERE node_id = ?`).run(memory.id);
                    } catch {
                        db.prepare(`DELETE FROM ${memory.table} WHERE rowid = ?`).run(memory.id);
                    }
                }
                deleted++;
                console.log(`🗑️ Deleted memory ${memory.id} from ${memory.table}`);
            } else if (mode === 'fix' && memory.correctedContent) {
                // Try different column and ID names
                const contentColumns = ['content', 'text', 'narrative'];
                const idColumns = ['id', 'node_id', 'rowid'];

                for (const contentCol of contentColumns) {
                    for (const idCol of idColumns) {
                        try {
                            const result = db.prepare(
                                `UPDATE ${memory.table} SET ${contentCol} = ? WHERE ${idCol} = ?`
                            ).run(memory.correctedContent, memory.id);

                            if (result.changes > 0) {
                                fixed++;
                                console.log(`✏️ Fixed memory ${memory.id} in ${memory.table}`);
                                break;
                            }
                        } catch {
                            // Try next combination
                        }
                    }
                }
            }
        } catch (err: any) {
            console.log(`❌ Error processing ${memory.id}: ${err.message}`);
        }
    }

    db.close();
    console.log(`\n📊 Results: ${fixed} fixed, ${deleted} deleted`);
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || (!args.includes('--fix') && !args.includes('--delete'));
    const deleteMode = args.includes('--delete');
    const fixMode = args.includes('--fix');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🧹 SILHOUETTE IDENTITY MEMORY CLEANUP');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Mode: ${dryRun ? '🔍 DRY RUN (preview only)' : deleteMode ? '🗑️ DELETE' : '✏️ FIX'}`);
    console.log('');

    // Find all possible database locations
    const dbPaths = [
        path.join(process.cwd(), 'db', 'silhouette.sqlite'),  // Actual location
        path.join(process.cwd(), 'data', 'silhouette.db'),
        path.join(process.cwd(), 'data', 'silhouette.sqlite'),
        path.join(process.cwd(), 'data', 'continuum.db'),
        path.join(process.cwd(), 'silhouette.db'),
        path.join(process.cwd(), 'memories.db'),
    ];

    let totalCorrupted: CorruptedMemory[] = [];

    for (const dbPath of dbPaths) {
        console.log(`\n📂 Scanning: ${dbPath}`);
        const corrupted = await findCorruptedMemories(dbPath);

        if (corrupted.length > 0) {
            console.log(`   Found ${corrupted.length} corrupted memories`);
            totalCorrupted.push(...corrupted.map(c => ({ ...c, dbPath })));

            // Store dbPath for later use
            for (const c of corrupted) {
                (c as any).dbPath = dbPath;
            }
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`📊 TOTAL CORRUPTED MEMORIES FOUND: ${totalCorrupted.length}`);
    console.log('═══════════════════════════════════════════════════════════');

    if (totalCorrupted.length === 0) {
        console.log('✅ No corrupted memories found! Database is clean.');
        return;
    }

    // Show preview
    console.log('\n📋 PREVIEW OF CORRUPTED MEMORIES:\n');
    for (const memory of totalCorrupted.slice(0, 10)) {
        console.log(`─────────────────────────────────────────────────`);
        console.log(`📍 Table: ${memory.table} | ID: ${memory.id}`);
        console.log(`❌ CORRUPTED: "${memory.content.substring(0, 100)}..."`);
        if (memory.correctedContent) {
            console.log(`✅ CORRECTED: "${memory.correctedContent.substring(0, 100)}..."`);
        }
    }

    if (totalCorrupted.length > 10) {
        console.log(`\n... and ${totalCorrupted.length - 10} more`);
    }

    if (dryRun) {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('🔍 DRY RUN COMPLETE - No changes made');
        console.log('');
        console.log('To apply fixes, run:');
        console.log('  npx tsx scripts/fix_identity_memories.ts --fix');
        console.log('');
        console.log('To delete corrupted memories instead:');
        console.log('  npx tsx scripts/fix_identity_memories.ts --delete');
        console.log('═══════════════════════════════════════════════════════════');
    } else {
        // Group by database path
        const byDb = new Map<string, CorruptedMemory[]>();
        for (const memory of totalCorrupted) {
            const dbPath = (memory as any).dbPath;
            if (!byDb.has(dbPath)) byDb.set(dbPath, []);
            byDb.get(dbPath)!.push(memory);
        }

        for (const [dbPath, memories] of byDb) {
            console.log(`\n🔧 Processing ${dbPath}...`);
            await fixMemories(dbPath, memories, deleteMode ? 'delete' : 'fix');
        }

        console.log('\n✅ CLEANUP COMPLETE');
    }
}

main().catch(console.error);
