/**
 * [W3] Artifact ledger: reads the filesystem jail's audit journal and answers
 * the only question the anti-theater gate cares about — which REAL writes did
 * these actors produce since T?
 *
 * Format-coupled to services/tools/fileJail.ts (W2) by the JSONL schema:
 * { ts, op, requestedPath, decision, resolvedPath, bytes, sha256, actor }.
 * Kept as a separate reader (instead of importing fileJail) so this module
 * stays dependency-free and testable; if the journal schema changes, BOTH
 * sides must change — the integration test pins the fields it consumes.
 */
import fs from 'fs';
import path from 'path';

export interface FsArtifact {
    ts: string;
    path: string;
    bytes?: number;
    sha256?: string;
    actor?: string;
}

function auditLogPath(): string {
    const env = (process.env.SILHOUETTE_FS_AUDIT_LOG || '').trim();
    return env || path.join(process.cwd(), 'data', 'fs-audit.jsonl');
}

/**
 * Allowed writes by any of `actors` with ts >= sinceMs (epoch). Malformed
 * lines are skipped, never fatal. Missing journal = zero artifacts (the
 * honest answer: no verified writes exist).
 */
export async function collectWrittenArtifacts(actors: Set<string>, sinceMs: number): Promise<FsArtifact[]> {
    let raw: string;
    try {
        raw = await fs.promises.readFile(auditLogPath(), 'utf-8');
    } catch {
        return [];
    }
    const artifacts: FsArtifact[] = [];
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let entry: any;
        try {
            entry = JSON.parse(line);
        } catch {
            continue; // corrupt line: skip, do not fail the gate on journal rot
        }
        if (entry.op !== 'write' || entry.decision !== 'allowed') continue;
        if (!actors.has(entry.actor)) continue;
        const ts = Date.parse(entry.ts || '');
        if (!Number.isFinite(ts) || ts < sinceMs) continue;
        artifacts.push({
            ts: entry.ts,
            path: entry.resolvedPath || entry.requestedPath,
            bytes: entry.bytes,
            sha256: entry.sha256,
            actor: entry.actor,
        });
    }
    return artifacts;
}
