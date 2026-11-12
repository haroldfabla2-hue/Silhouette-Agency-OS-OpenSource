import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validEmbedding, type EmbeddingIdentity } from './memoryRetrieval';

export interface ProjectionIntent {
    key: string;
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
            body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0, last_failure TEXT
        )`);
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
        return this.db.prepare("SELECT body FROM projection_intents WHERE state = 'pending' ORDER BY rowid LIMIT ?")
            .all(Math.max(1, Math.min(500, limit))).map((r: any) => JSON.parse(r.body));
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
