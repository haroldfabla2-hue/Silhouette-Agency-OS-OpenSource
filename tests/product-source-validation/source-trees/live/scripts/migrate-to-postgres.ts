#!/usr/bin/env npx ts-node
// =============================================================================
// Silhouette Agency OS — SQLite → PostgreSQL Data Migration Script
// Transfers ALL data from SQLite + LanceDB to PostgreSQL + pgvector.
// 
// Usage:
//   DATABASE_URL=postgresql://user:pass@host:5432/silhouette npx ts-node scripts/migrate-to-postgres.ts
//
// Prerequisites:
//   - PostgreSQL with pgvector extension must be running
//   - Run migrations/001_initial_schema.sql first (or let the adapter auto-create tables)
//   - Existing SQLite databases must be accessible at their default locations
//
// Safety:
//   - Read-only on SQLite sources (never writes or deletes)
//   - Uses UPSERT (ON CONFLICT) on Postgres to be safely re-runnable
//   - Wraps each table in a transaction for atomicity
//   - Logs every step with counts for verification
// =============================================================================

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

// ─── Config ──────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required.');
    console.error('   Example: DATABASE_URL=postgresql://silhouette:pass@localhost:5432/silhouette');
    process.exit(1);
}

const DB_DIR = path.resolve(process.cwd(), 'db');
const MAIN_DB_PATH = path.join(DB_DIR, 'silhouette.sqlite');
const IDENTITY_DB_PATH = path.join(DB_DIR, 'identity.sqlite');
const LANCE_DB_PATH = path.join(DB_DIR, 'lancedb');

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MigrationStats {
    table: string;
    migrated: number;
    skipped: number;
    errors: number;
}

const stats: MigrationStats[] = [];

function logStep(msg: string) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${msg}`);
    console.log(`${'═'.repeat(60)}`);
}

function logTable(table: string, count: number) {
    console.log(`  ✅ ${table}: ${count} rows migrated`);
}

async function migrateTable(
    pool: Pool,
    sourceDb: Database.Database,
    tableName: string,
    pgInsertQuery: string,
    rowMapper: (row: any) => any[]
): Promise<number> {
    const rows = sourceDb.prepare(`SELECT * FROM ${tableName}`).all();
    if (rows.length === 0) {
        console.log(`  ⏭️  ${tableName}: 0 rows (empty table, skipping)`);
        stats.push({ table: tableName, migrated: 0, skipped: 0, errors: 0 });
        return 0;
    }

    const client = await pool.connect();
    let migrated = 0;
    let errors = 0;

    try {
        await client.query('BEGIN');

        for (const row of rows) {
            try {
                const params = rowMapper(row);
                await client.query(pgInsertQuery, params);
                migrated++;
            } catch (err: any) {
                if (err.code === '23505') {
                    // Duplicate key — data already exists, skip
                    migrated++;
                } else {
                    errors++;
                    console.error(`    ⚠️ Error migrating row in ${tableName}:`, err.message);
                }
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    logTable(tableName, migrated);
    stats.push({ table: tableName, migrated, skipped: rows.length - migrated, errors });
    return migrated;
}

// ─── Main Migration ──────────────────────────────────────────────────────────

async function main() {
    console.log('\n🚀 Silhouette Agency OS — SQLite → PostgreSQL Migration');
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    console.log(`   Target: ${DATABASE_URL?.replace(/\/\/.*@/, '//<credentials>@')}`);

    const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

    // ── Phase 1: Main Database ────────────────────────────────────────

    if (fs.existsSync(MAIN_DB_PATH)) {
        logStep('Phase 1: Migrating Main Database (silhouette.sqlite)');
        const mainDb = new Database(MAIN_DB_PATH, { readonly: true });

        // Agents
        await migrateTable(pool, mainDb, 'agents',
            `INSERT INTO agents (id, name, role, status, data, last_active)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, last_active = EXCLUDED.last_active`,
            (r) => [r.id, r.name, r.role, r.status, r.data, r.last_active]
        );

        // System Logs
        await migrateTable(pool, mainDb, 'system_logs',
            `INSERT INTO system_logs (id, level, message, source, timestamp, details)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (id) DO NOTHING`,
            (r) => [r.id, r.level, r.message, r.source, r.timestamp, r.details]
        );

        // Tasks
        await migrateTable(pool, mainDb, 'tasks',
            `INSERT INTO tasks (id, description, assigned_to, status, created_at, updated_at, data)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
            (r) => [r.id, r.description, r.assigned_to, r.status, r.created_at, r.updated_at, r.data]
        );

        // Cost Metrics
        await migrateTable(pool, mainDb, 'cost_metrics',
            `INSERT INTO cost_metrics (id, data, updated_at)
             VALUES ($1,$2,$3)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
            (r) => [r.id, r.data, r.updated_at]
        );

        // System Config
        await migrateTable(pool, mainDb, 'system_config',
            `INSERT INTO system_config (key, value, updated_at)
             VALUES ($1,$2,$3)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
            (r) => [r.key, r.value, r.updated_at]
        );

        // Chat Sessions (must come before chat_logs due to FK)
        await migrateTable(pool, mainDb, 'chat_sessions',
            `INSERT INTO chat_sessions (id, title, created_at, last_updated, metadata)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET last_updated = EXCLUDED.last_updated`,
            (r) => [r.id, r.title, r.created_at, r.last_updated, r.metadata || null]
        );

        // Chat Logs
        await migrateTable(pool, mainDb, 'chat_logs',
            `INSERT INTO chat_logs (id, session_id, role, content, timestamp, metadata)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (id) DO NOTHING`,
            (r) => [r.id, r.session_id, r.role, r.content, r.timestamp, r.metadata]
        );

        // UI State
        await migrateTable(pool, mainDb, 'ui_state',
            `INSERT INTO ui_state (component_id, state, last_updated)
             VALUES ($1,$2,$3)
             ON CONFLICT (component_id) DO UPDATE SET state = EXCLUDED.state`,
            (r) => [r.component_id, r.state, r.last_updated]
        );

        // Assets
        await migrateTable(pool, mainDb, 'assets',
            `INSERT INTO assets (id, type, name, description, file_path, thumbnail_path, size_bytes, mime_type, prompt, provider, tags, metadata, folder, is_favorite, is_archived, created_at, updated_at, accessed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
            (r) => [r.id, r.type, r.name, r.description, r.file_path, r.thumbnail_path,
            r.size_bytes, r.mime_type, r.prompt, r.provider, r.tags, r.metadata,
            r.folder, !!r.is_favorite, !!r.is_archived, r.created_at, r.updated_at, r.accessed_at]
        );

        // Discovery Journal
        await migrateTable(pool, mainDb, 'discovery_journal',
            `INSERT INTO discovery_journal (id, timestamp, source_node, target_node, decision, confidence, feedback, refinement_hint, relation_type, retry_count, final_outcome, discovery_source, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (id) DO NOTHING`,
            (r) => [r.id, r.timestamp, r.source_node, r.target_node, r.decision, r.confidence,
            r.feedback, r.refinement_hint, r.relation_type, r.retry_count,
            r.final_outcome, r.discovery_source, r.metadata]
        );

        // Synthesized Insights
        await migrateTable(pool, mainDb, 'synthesized_insights',
            `INSERT INTO synthesized_insights (id, title, summary, discoveries, patterns, novel_hypothesis, supporting_evidence, confidence, domain, created_at, paper_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (id) DO NOTHING`,
            (r) => [r.id, r.title, r.summary, r.discoveries, r.patterns, r.novel_hypothesis,
            r.supporting_evidence, r.confidence, r.domain, r.created_at, r.paper_id]
        );

        // Generated Papers
        await migrateTable(pool, mainDb, 'generated_papers',
            `INSERT INTO generated_papers (id, title, authors, abstract, sections, paper_references, keywords, insight_id, format, status, peer_review_score, peer_review_feedback, file_path, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (id) DO NOTHING`,
            (r) => [r.id, r.title, r.authors, r.abstract, r.sections, r.paper_references,
            r.keywords, r.insight_id, r.format, r.status, r.peer_review_score,
            r.peer_review_feedback, r.file_path, r.created_at, r.updated_at]
        );

        // Evolution History (auto-increment id, map to serial)
        const evolRows = mainDb.prepare('SELECT * FROM evolution_history').all() as any[];
        if (evolRows.length > 0) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                for (const r of evolRows) {
                    await client.query(
                        `INSERT INTO evolution_history (agent_id, agent_name, previous_score, new_score, trigger_type, triggered_by, improvements, created_at)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                        [r.agent_id, r.agent_name, r.previous_score, r.new_score,
                        r.trigger_type, r.triggered_by, r.improvements, r.created_at]
                    );
                }
                await client.query('COMMIT');
                logTable('evolution_history', evolRows.length);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error('  ⚠️ evolution_history migration error:', err);
            } finally {
                client.release();
            }
        }

        // Voices
        await migrateTable(pool, mainDb, 'voices',
            `INSERT INTO voices (id, name, category, language, gender, style, sample_path, thumbnail_url, source_url, is_downloaded, is_default, quality_score, usage_count, last_used_at, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
            (r) => [r.id, r.name, r.category, r.language, r.gender, r.style,
            r.sample_path, r.thumbnail_url, r.source_url,
            !!r.is_downloaded, !!r.is_default, r.quality_score,
            r.usage_count, r.last_used_at, r.created_at, r.updated_at]
        );

        // Voice Clone Sessions
        await migrateTable(pool, mainDb, 'voice_clone_sessions',
            `INSERT INTO voice_clone_sessions (id, voice_id, input_path, input_duration, input_quality, noise_level, silence_ratio, was_normalized, was_denoised, processed_path, processing_time, status, error_message, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (id) DO NOTHING`,
            (r) => [r.id, r.voice_id, r.input_path, r.input_duration, r.input_quality,
            r.noise_level, r.silence_ratio, !!r.was_normalized, !!r.was_denoised,
            r.processed_path, r.processing_time, r.status, r.error_message, r.created_at]
        );

        mainDb.close();
    } else {
        console.warn(`  ⚠️ Main database not found at: ${MAIN_DB_PATH}`);
    }

    // ── Phase 2: Identity Database ────────────────────────────────────

    if (fs.existsSync(IDENTITY_DB_PATH)) {
        logStep('Phase 2: Migrating Identity Database (identity.sqlite)');
        const identityDb = new Database(IDENTITY_DB_PATH, { readonly: true });

        // Check if tables exist
        const tables = identityDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'devices', 'sessions')"
        ).all() as { name: string }[];
        const tableNames = new Set(tables.map(t => t.name));

        if (tableNames.has('users')) {
            await migrateTable(pool, identityDb, 'users',
                `INSERT INTO users (id, email, password_hash, name, avatar_url, role, google_linked, google_email, telegram_id, discord_id, whatsapp_id, created_at, last_login)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                 ON CONFLICT (id) DO UPDATE SET last_login = EXCLUDED.last_login`,
                (r) => [r.id, r.email, r.password_hash, r.name, r.avatar_url, r.role,
                !!r.google_linked, r.google_email, r.telegram_id, r.discord_id,
                r.whatsapp_id, r.created_at, r.last_login]
            );
        }

        if (tableNames.has('devices')) {
            await migrateTable(pool, identityDb, 'devices',
                `INSERT INTO devices (id, user_id, fingerprint, name, trusted, last_seen, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen`,
                (r) => [r.id, r.user_id, r.fingerprint, r.name, !!r.trusted, r.last_seen, r.created_at]
            );
        }

        if (tableNames.has('sessions')) {
            await migrateTable(pool, identityDb, 'sessions',
                `INSERT INTO sessions (id, user_id, device_id, expires_at, created_at)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (id) DO NOTHING`,
                (r) => [r.id, r.user_id, r.device_id, r.expires_at, r.created_at]
            );
        }

        identityDb.close();
    } else {
        console.warn(`  ⚠️ Identity database not found at: ${IDENTITY_DB_PATH}`);
    }

    // ── Phase 3: LanceDB Vector Data ──────────────────────────────────

    logStep('Phase 3: Migrating LanceDB Vector Data');
    if (fs.existsSync(LANCE_DB_PATH)) {
        try {
            // Dynamic import — uses the same package as the rest of the project
            const lancedb = await import('@lancedb/lancedb');
            const db = await lancedb.connect(LANCE_DB_PATH);
            const tableNames = await db.tableNames();

            for (const tableName of tableNames) {
                try {
                    const table = await db.openTable(tableName);
                    const data = await table.query().limit(100000).toArray();

                    if (data.length === 0) {
                        console.log(`  ⏭️  LanceDB/${tableName}: 0 rows (empty)`);
                        continue;
                    }

                    const client = await pool.connect();
                    let migrated = 0;

                    try {
                        await client.query('BEGIN');

                        const pgTable = tableName === 'knowledge' ? 'knowledge_vectors' : 'memory_vectors';

                        for (const row of data) {
                            const vector = row.vector || row.embedding;
                            if (!vector || vector.length === 0) continue;

                            // Pad/trim to 768 dimensions
                            let embedding = Array.from(vector) as number[];
                            if (embedding.length > 768) embedding = embedding.slice(0, 768);
                            if (embedding.length < 768) embedding = [...embedding, ...new Array(768 - embedding.length).fill(0)];
                            const vecStr = `[${embedding.join(',')}]`;

                            if (pgTable === 'memory_vectors') {
                                await client.query(
                                    `INSERT INTO memory_vectors (id, content, tier, importance, access_count, tags, metadata, source, category, created_at, last_accessed, embedding)
                                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)
                                     ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding`,
                                    [row.id || `lance-${migrated}`, row.content || '', row.tier || 'WORKING',
                                    row.importance || 0.5, row.accessCount || 0,
                                    JSON.stringify(row.tags || []), JSON.stringify(row.metadata || {}),
                                    row.source || '', row.category || '',
                                    row.timestamp || Date.now(), row.lastAccess || Date.now(),
                                        vecStr]
                                );
                            } else {
                                await client.query(
                                    `INSERT INTO knowledge_vectors (id, content, source, category, tags, metadata, created_at, embedding)
                                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
                                     ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding`,
                                    [row.id || `knowledge-${migrated}`, row.content || row.text || '',
                                    row.source || '', row.category || '',
                                    JSON.stringify(row.tags || []), JSON.stringify(row.metadata || {}),
                                    row.timestamp || Date.now(), vecStr]
                                );
                            }
                            migrated++;
                        }

                        await client.query('COMMIT');
                        logTable(`LanceDB/${tableName} → ${pgTable}`, migrated);
                    } catch (err) {
                        await client.query('ROLLBACK');
                        console.error(`  ⚠️ LanceDB/${tableName} migration error:`, err);
                    } finally {
                        client.release();
                    }
                } catch (err: any) {
                    console.error(`  ⚠️ Could not open LanceDB table ${tableName}:`, err.message);
                }
            }
        } catch (err: any) {
            console.warn(`  ⚠️ LanceDB migration skipped: ${err.message}`);
            console.warn('     This is normal if lancedb/vectordb is not installed in this environment.');
            console.warn('     Vector data can be migrated separately when the lancedb package is available.');
        }
    } else {
        console.warn(`  ⚠️ LanceDB directory not found at: ${LANCE_DB_PATH}`);
    }

    // ── Summary ───────────────────────────────────────────────────────

    logStep('Migration Complete — Summary');
    console.log('\n  Table                    | Migrated | Skipped | Errors');
    console.log('  ' + '─'.repeat(56));
    for (const s of stats) {
        const name = s.table.padEnd(25);
        console.log(`  ${name}| ${String(s.migrated).padEnd(9)}| ${String(s.skipped).padEnd(8)}| ${s.errors}`);
    }

    const totalMigrated = stats.reduce((sum, s) => sum + s.migrated, 0);
    const totalErrors = stats.reduce((sum, s) => sum + s.errors, 0);
    console.log(`\n  Total: ${totalMigrated} rows migrated, ${totalErrors} errors`);

    if (totalErrors === 0) {
        console.log('\n  ✅ Migration completed successfully with zero errors!');
    } else {
        console.log('\n  ⚠️ Migration completed with some errors. Review the output above.');
    }

    try {
        logStep('Syncing Sequences');
        // Update sequences for tables with SERIAL primary keys
        await pool.query(`
            SELECT setval('system_logs_id_seq', coalesce((SELECT max(id) FROM system_logs), 0) + 1, false);
            SELECT setval('evolution_history_id_seq', coalesce((SELECT max(id) FROM evolution_history), 0) + 1, false);
            SELECT setval('system_migrations_id_seq', coalesce((SELECT max(id) FROM system_migrations), 0) + 1, false);
        `);
        console.log('  ✅ PostgreSQL sequences synchronized');
    } catch (e: any) {
        console.warn(`  ⚠️ Could not sync sequences (ignorable if tables are empty): ${e.message}`);
    }

    await pool.end();
}

main().catch(err => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
});
