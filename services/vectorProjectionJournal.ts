import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validEmbedding, type EmbeddingIdentity } from './memoryRetrieval';

export interface ProjectionIntent {
    key: string;
    phase?: string;
    id: string;
    checksum: string;
    node: any;
    vector: number[];
    identity: EmbeddingIdentity;
}
export const canonicalChecksum = (node: unknown): string => createHash('sha256').update(JSON.stringify(node)).digest('hex');

/** Intent before the canonical write, verified-source replay after it.
 * No timers, network, LLMs, deletion or production singleton at import time.
 * Intent storage failure aborts BEFORE the canonical write. A failed optional
 * projection never turns an already verified canonical success into a retry.
 */
export class VectorProjectionJournal {
    private db: Database.Database;
    constructor(filename: string) {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        this.db = new Database(filename);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = FULL');
        this.db.exec(`CREATE TABLE IF NOT EXISTS projection_intents (
            key TEXT PRIMARY KEY, id TEXT NOT NULL, checksum TEXT NOT NULL,
            body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'prepared',
            attempts INTEGER NOT NULL DEFAULT 0, last_failure TEXT
        ); CREATE TABLE IF NOT EXISTS projection_scan_cursor (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1), after_rowid INTEGER NOT NULL
        ); INSERT OR IGNORE INTO projection_scan_cursor VALUES(1,0)`);
    }
    prepare(node: any, vector: number[], identity: EmbeddingIdentity): ProjectionIntent {
        if (!node?.id || !validEmbedding(vector, identity)) throw new Error('Invalid projection intent');
        const checksum = canonicalChecksum(node);
        const key = canonicalChecksum({ id: node.id, checksum, identity, vectorDigest: canonicalChecksum(vector) });
        const intent = { key, id: node.id, checksum, node, vector, identity };
        this.db.prepare('INSERT OR IGNORE INTO projection_intents(key,id,checksum,body) VALUES(?,?,?,?)')
            .run(key, node.id, checksum, JSON.stringify(intent));
        return intent;
    }
    pending(limit = 50): ProjectionIntent[] {
        const cursor = (this.db.prepare('SELECT after_rowid FROM projection_scan_cursor WHERE singleton = 1').get() as any).after_rowid;
        const rows = this.db.prepare("SELECT rowid,body,state FROM projection_intents WHERE state IN ('prepared','pending') ORDER BY CASE WHEN rowid > ? THEN 0 ELSE 1 END, rowid LIMIT ?")
            .all(cursor, Math.max(1, Math.min(500, limit))) as any[];
        if (rows.length) this.db.prepare('UPDATE projection_scan_cursor SET after_rowid = ? WHERE singleton = 1').run(rows[rows.length - 1].rowid);
        return rows.map(row => ({ ...JSON.parse(row.body), phase: row.state }));
    }
    pendingCount(): number {
        return (this.db.prepare("SELECT COUNT(*) AS count FROM projection_intents WHERE state IN ('prepared','pending')").get() as any).count;
    }
    canonicalVerified(key: string): void {
        this.db.prepare("UPDATE projection_intents SET state = 'pending' WHERE key = ? AND state = 'prepared'").run(key);
    }
    completed(key: string): void {
        this.db.prepare("UPDATE projection_intents SET state = 'complete', last_failure = NULL WHERE key = ?").run(key);
    }
    superseded(key: string): void {
        // Retain history, never remove an intent that might explain a failed write.
        this.db.prepare("UPDATE projection_intents SET state = 'superseded' WHERE key = ?").run(key);
    }
    failed(key: string): void {
        this.db.prepare("UPDATE projection_intents SET attempts = attempts + 1, last_failure = 'projection_unavailable' WHERE key = ?").run(key);
    }
    retainedUnsupported(key: string): void {
        this.db.prepare("UPDATE projection_intents SET state = 'retained_unsupported' WHERE key = ?").run(key);
    }
    stats(): Record<string, number> {
        return Object.fromEntries((this.db.prepare('SELECT state, COUNT(*) AS count FROM projection_intents GROUP BY state').all() as any[]).map(row => [row.state, row.count]));
    }
    close(): void { this.db.close(); }
}
