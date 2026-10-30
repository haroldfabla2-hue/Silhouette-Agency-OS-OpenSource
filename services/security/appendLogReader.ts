/**
 * Shared tail reader for the append-only claim logs (consent ledger,
 * replay marks, proposal owner). Streaming: the file is read in bounded
 * chunks, so there is NO file-size limit and no restart brick - the honest
 * limit is the in-memory fold, watched by the stores' WARN thresholds.
 *
 * File identity + continuity: the cached state carries (dev, ino), the
 * folded byte offset, and the hash+length of the last folded line. A
 * replaced file (restore, manual rotation, cp) has a different inode; a
 * same-inode rewrite is caught by re-reading the last folded line and
 * comparing its hash. Any mismatch folds the whole file again - the fold
 * is idempotent (first-wins PUT, preconditioned claims), so a re-fold is
 * safe. A torn final line (crash mid-append) is never folded and is
 * retried on the next read.
 */
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

export interface ReaderState {
    dev: number;
    ino: number;
    /** Bytes folded so far; always lands just past a '\n'. */
    offset: number;
    /** Byte length (with '\n') and sha256 of the last folded line. */
    tailBytes: number;
    tailHash: string;
}

export interface TailRead {
    /** New complete lines; when reset is true this is the WHOLE file. */
    lines: string[];
    state: ReaderState;
    /** True when the file identity or continuity changed: the caller must
     *  discard its fold and rebuild it from these lines. */
    reset: boolean;
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const EMPTY: ReaderState = { dev: 0, ino: 0, offset: 0, tailBytes: 0, tailHash: '' };

export function readAppendedLines(file: string, prev: ReaderState | null, chunkBytes = 1024 * 1024): TailRead {
    let st: fs.Stats;
    try {
        st = fs.statSync(file);
    } catch (e: any) {
        if (e?.code === 'ENOENT') return { lines: [], state: prev ?? { ...EMPTY }, reset: false };
        throw e; // a read failure is never an empty log: fail closed
    }
    let state = prev;
    let reset = false;
    const fd = fs.openSync(file, 'r');
    try {
        if (state && (state.dev !== st.dev || state.ino !== st.ino || st.size < state.offset)) state = null;
        if (state && state.offset > 0) {
            const buf = Buffer.alloc(state.tailBytes);
            const got = fs.readSync(fd, buf, 0, buf.length, state.offset - state.tailBytes);
            if (got !== state.tailBytes || sha(buf) !== state.tailHash) state = null;
        }
        if (!state) {
            state = { dev: st.dev, ino: st.ino, offset: 0, tailBytes: 0, tailHash: '' };
            reset = true;
        }
        const lines: string[] = [];
        let pos = state.offset;
        let pending = Buffer.alloc(0);
        while (pos < st.size) {
            const want = Math.min(chunkBytes, st.size - pos);
            const chunk = Buffer.alloc(want);
            fs.readSync(fd, chunk, 0, want, pos);
            pos += want;
            pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
            let nl = pending.indexOf(0x0a); // 0x0A cannot appear inside a UTF-8 multibyte sequence
            while (nl >= 0) {
                lines.push(pending.subarray(0, nl).toString('utf8'));
                state.tailBytes = nl + 1;
                state.tailHash = sha(pending.subarray(0, nl + 1));
                pending = pending.subarray(nl + 1);
                nl = pending.indexOf(0x0a);
            }
        }
        state.offset = st.size - pending.length;
        return { lines, state, reset };
    } finally {
        fs.closeSync(fd);
    }
}
