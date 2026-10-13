/**
 * Cold archive (roadmap item 7): append-only, second-copy store for full
 * memory originals, plus deep recall over it.
 *
 * Design (from the F0-F2 research, BELIEFMEM/Kumiho): the archive is a
 * SECOND COPY — the primary store already keeps everything (eternal-memory
 * invariant). Summaries and tags in the hot tiers are INDEXES, never
 * replacements; the full original always survives here byte-for-byte.
 *
 * Hard rules implemented structurally:
 *   - append-only JSONL; this module has NO delete/truncate/rewrite path
 *   - idempotent per node id (second copy, not a write-ahead log)
 *   - recall_deep returns FULL originals, never summaries
 */

import fs from 'fs';
import path from 'path';
import { MemoryNode } from '../../types';

export interface ColdArchiveEntry {
    archivedAt: number;
    reason: string;
    node: MemoryNode;
}

export interface ColdArchiveConfig {
    enabled: boolean;    // COLD_ARCHIVE_ENABLED, default true
    filePath: string;    // COLD_ARCHIVE_PATH, default <cwd>/data/cold-archive.jsonl
}

export const loadColdArchiveConfig = (env: NodeJS.ProcessEnv = process.env): ColdArchiveConfig => ({
    enabled: (env.COLD_ARCHIVE_ENABLED ?? 'true').toLowerCase() !== 'false',
    filePath: env.COLD_ARCHIVE_PATH || path.resolve(process.cwd(), 'data', 'cold-archive.jsonl')
});

/** Accent/case-insensitive tokenization (same spirit as continuum's lexical match). */
const tokenize = (s: string): string[] =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);

const score = (content: string, queryTokens: string[]): number => {
    const doc = new Set(tokenize(content));
    if (doc.size === 0) return 0;
    const hits = queryTokens.filter(t => doc.has(t)).length;
    return hits / Math.max(1, queryTokens.length);
};

export class ColdArchive {
    constructor(private readonly config: ColdArchiveConfig = loadColdArchiveConfig()) {}

    /** Append a full original as a second copy. Idempotent per node id.
     *  Returns true when a new entry was written. Never throws on IO errors
     *  when disabled; IO errors propagate so callers can log them. */
    append(node: MemoryNode, reason: string): boolean {
        if (!this.config.enabled) return false;
        if (this.has(node.id)) return false;
        fs.mkdirSync(path.dirname(this.config.filePath), { recursive: true });
        const entry: ColdArchiveEntry = { archivedAt: Date.now(), reason, node };
        fs.appendFileSync(this.config.filePath, JSON.stringify(entry) + '\n', 'utf-8');
        return true;
    }

    has(nodeId: string): boolean {
        return this.readAll().some(e => e.node.id === nodeId);
    }

    readAll(): ColdArchiveEntry[] {
        try {
            if (!fs.existsSync(this.config.filePath)) return [];
            return fs.readFileSync(this.config.filePath, 'utf-8')
                .split('\n').filter(l => l.trim())
                .map(l => JSON.parse(l) as ColdArchiveEntry);
        } catch {
            return [];
        }
    }

    /** Deep recall: lexical search over full archived originals.
     *  Returns complete entries (full content, never a summary). */
    recall(query: string, limit = 5): ColdArchiveEntry[] {
        const qt = tokenize(query);
        if (qt.length === 0) return [];
        return this.readAll()
            .map(e => ({ e, s: score(e.node.content || '', qt) }))
            .filter(x => x.s > 0)
            .sort((a, b) => (b.s - a.s) || (b.e.archivedAt - a.e.archivedAt))
            .slice(0, limit)
            .map(x => x.e);
    }

    stats(): { entries: number; oldest: number | null; newest: number | null } {
        const all = this.readAll();
        return {
            entries: all.length,
            oldest: all.length ? Math.min(...all.map(e => e.archivedAt)) : null,
            newest: all.length ? Math.max(...all.map(e => e.archivedAt)) : null
        };
    }
}

let singleton: ColdArchive | null = null;
export const getColdArchive = (): ColdArchive => {
    if (!singleton) singleton = new ColdArchive();
    return singleton;
};
