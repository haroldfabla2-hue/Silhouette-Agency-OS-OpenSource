import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/** Replacement happened, but durability confirmation failed. Do not retry blindly. */
export class AtomicWriteAppliedError extends Error {
    readonly code = 'ATOMIC_WRITE_APPLIED_DURABILITY_UNKNOWN';
    readonly applied = true;
    readonly shaAfter: string;
    journalRecorded?: boolean;
    constructor(shaAfter: string, cause: unknown) {
        super('File replacement APPLIED; directory sync failed, durability UNKNOWN. Inspect the target before retrying.', { cause });
        this.name = 'AtomicWriteAppliedError';
        this.shaAfter = shaAfter;
    }
}

/**
 * Replace one regular file using a verified, synced sibling temporary file.
 * Readers see the old file or the complete new file, never a partial write.
 * Not a multi-file transaction, writer lock, or power-loss guarantee.
 * The caller must confine the destination and enforce its size/policy limits.
 */
export function atomicWriteFile(destination: string, content: string | Buffer): void {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const parent = path.dirname(destination);
    // Do not silently replace a symlink or another special file.
    let existing: fs.Stats | null = null;
    try { existing = fs.lstatSync(destination); } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (existing && !existing.isFile()) throw new Error('atomic write requires a regular file; target unchanged');
    if (existing && existing.nlink > 1) throw new Error('atomic write refuses hard-linked targets; target unchanged (rename would break shared-inode semantics)');
    const temporary = path.join(parent, `.selfcode-${crypto.randomUUID()}.tmp`);
    let fd: number | undefined;
    let renamed = false;
    try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
        const actual = fs.readFileSync(temporary);
        const digest = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');
        if (actual.length !== bytes.length || digest(actual) !== digest(bytes)) {
            throw new Error('temporary file verification failed');
        }
        // Preserve permissions of an existing target; new files stay private.
        if (existing) {
            const mode = existing.mode & 0o7777;
            fs.fchmodSync(fd, mode);
            if ((fs.fstatSync(fd).mode & 0o7777) !== mode) {
                throw new Error('cannot preserve target permission bits; target unchanged');
            }
        }
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temporary, destination);
        renamed = true;
        // A failure here is reported, even though replacement already occurred.
        try {
            const directory = fs.openSync(parent, 'r');
            try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        } catch (cause) {
            throw new AtomicWriteAppliedError(digest(bytes), cause);
        }
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (!renamed) {
            try { fs.unlinkSync(temporary); } catch (error: any) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }
}
