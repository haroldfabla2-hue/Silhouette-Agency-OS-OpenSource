/**
 * [W2] Filesystem jail for the LLM-facing filesystem tools
 * (read_file / write_file / list_files).
 *
 * Factory fire test (2026-10-14) found these tools registered with RAW
 * handlers: fs.writeFile(args.path) with no confinement, no audit, no caps —
 * any agent with the tool could read /opt/silhouette/.env (secrets) or
 * overwrite any file the process user can touch.
 *
 * This module is the single confinement chokepoint. Fail-closed everywhere:
 * if a root cannot be resolved, the operation is DENIED with an explicit
 * reason, never allowed "to be safe".
 *
 * Configuration (env-driven, nothing hardcoded):
 *   SILHOUETTE_FS_WRITE_ROOTS    path-delimited allowlist for writes
 *                                (default: <cwd>/workspace — the Genesis
 *                                factory root)
 *   SILHOUETTE_FS_READ_ROOTS     path-delimited allowlist for reads
 *                                (default: <cwd> and the OS temp dir)
 *   SILHOUETTE_FS_MAX_WRITE_BYTES  per-call content cap (default 1 MiB)
 *   SILHOUETTE_FS_AUDIT_LOG      JSONL audit journal
 *                                (default: <cwd>/data/fs-audit.jsonl)
 *
 * Secret-bearing names (.env*, *.pem/key/p12, SSH keys, *.sqlite, anything
 * under .git) are denied inside EVERY root, for reads and writes.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export type JailResolution =
    | { ok: true; resolved: string; root: string }
    | { ok: false; reason: string };

/** Name patterns that are never readable/writable through the tools, even inside a root. */
const DENIED_SEGMENT_PATTERNS: Array<{ re: RegExp; why: string }> = [
    { re: /^\.git$/i, why: 'paths may not traverse .git' },
    { re: /^\.env(\..+)?$/i, why: 'environment files may contain secrets' },
    { re: /\.(pem|key|p12|pfx|keystore|jks)$/i, why: 'key material is not tool-accessible' },
    { re: /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, why: 'SSH keys are not tool-accessible' },
    { re: /^\.netrc$/i, why: 'credential files are not tool-accessible' },
    { re: /^credentials(\.json)?$/i, why: 'credential files are not tool-accessible' },
    { re: /\.sqlite(-wal|-shm)?$/i, why: 'databases are accessed through services, not files' },
];

function deniedSegment(relPath: string): string | null {
    for (const seg of relPath.split(path.sep)) {
        for (const { re, why } of DENIED_SEGMENT_PATTERNS) {
            if (re.test(seg)) return `${why} (segment "${seg}")`;
        }
    }
    return null;
}

export function writeRoots(): string[] {
    const env = (process.env.SILHOUETTE_FS_WRITE_ROOTS || '').trim();
    if (env) return env.split(path.delimiter).map(s => s.trim()).filter(Boolean);
    return [path.join(process.cwd(), 'workspace')];
}

export function readRoots(): string[] {
    const env = (process.env.SILHOUETTE_FS_READ_ROOTS || '').trim();
    if (env) return env.split(path.delimiter).map(s => s.trim()).filter(Boolean);
    return [process.cwd(), os.tmpdir()];
}

export function maxWriteBytes(): number {
    const n = Number(process.env.SILHOUETTE_FS_MAX_WRITE_BYTES);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1_048_576;
}

function auditLogPath(): string {
    const env = (process.env.SILHOUETTE_FS_AUDIT_LOG || '').trim();
    return env || path.join(process.cwd(), 'data', 'fs-audit.jsonl');
}

export interface FsAuditEntry {
    op: 'read' | 'write' | 'list';
    requestedPath: string;
    decision: 'allowed' | 'denied';
    reason?: string;
    resolvedPath?: string;
    root?: string;
    bytes?: number;
    sha256?: string;
    actor?: string;
    actorRole?: string;
}

/**
 * Append-only audit journal. Every decision (allowed AND denied) is
 * journaled. Best-effort delivery: a full disk never blocks or, worse,
 * flips a denial into an allowance — but the operation result is only
 * returned after the append attempt completes.
 */
export async function auditFs(entry: FsAuditEntry): Promise<void> {
    try {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
        const logPath = auditLogPath();
        await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
        await fs.promises.appendFile(logPath, line, 'utf-8');
    } catch (e: any) {
        console.warn(`[FS-JAIL] audit append failed (operation outcome unaffected): ${e.message}`);
    }
}

/**
 * Resolve `rawPath` against the allowlisted roots, symlink-safely.
 * The deepest EXISTING ancestor is realpath()'d (collapsing symlinks),
 * then the non-existing tail is re-appended lexically. The result must
 * equal a root or live under one; denied-name segments are rejected even
 * inside a root.
 */
export function resolveWithinRoots(rawPath: string, roots: string[]): JailResolution {
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
        return { ok: false, reason: 'empty path' };
    }
    const abs = path.resolve(rawPath);

    // Deepest existing ancestor + missing tail (for not-yet-created files).
    const missingTail: string[] = [];
    let existing = abs;
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) return { ok: false, reason: 'no existing ancestor on filesystem' };
        missingTail.unshift(path.basename(existing));
        existing = parent;
    }

    let realAncestor: string;
    try {
        realAncestor = fs.realpathSync(existing);
    } catch (e: any) {
        return { ok: false, reason: `realpath failed for ancestor: ${e.message}` };
    }
    const resolved = path.join(realAncestor, ...missingTail);

    for (const rootRaw of roots) {
        let rootReal: string;
        try {
            rootReal = fs.realpathSync(rootRaw);
        } catch {
            continue; // unresolvable root: fail-closed for THIS root, try the rest
        }
        if (resolved === rootReal || resolved.startsWith(rootReal + path.sep)) {
            const denied = deniedSegment(path.relative(rootReal, resolved));
            if (denied) return { ok: false, reason: denied };
            return { ok: true, resolved, root: rootReal };
        }
    }
    return { ok: false, reason: `path escapes allowed roots (${roots.join(', ') || 'none configured'})` };
}

/** Type-guard narrowing that works regardless of the project's strict flags. */
export function jailDenied(r: JailResolution): r is { ok: false; reason: string } {
    return !r.ok;
}

export function resolveWrite(rawPath: string): JailResolution {
    return resolveWithinRoots(rawPath, writeRoots());
}

export function resolveRead(rawPath: string): JailResolution {
    return resolveWithinRoots(rawPath, readRoots());
}

export function sha256Of(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}
