/**
 * Shared tail reader for the append-only claim logs (consent ledger,
 * replay marks, proposal owner). Streaming: the file is read in bounded
 * chunks and each complete line is handed to a fold callback as it is
 * read - no whole-file array, no file-size limit, no restart brick at
 * any log size. The honest residual limit is the in-memory fold, watched
 * by the stores' WARN thresholds (compaction is tracked debt).
 *
 * File identity + continuity (SCOPE DECLARED EXACTLY): the cached state
 * carries (dev, ino), the folded byte offset, and the hash+length of the
 * last folded line. This detects: atomic replace (restore/cp/rotation ->
 * new inode), truncation (size < offset), and in-place rewrites that
 * change the tail line. It does NOT detect a same-inode edit of EARLIER
 * bytes that leaves the last line and size plausible - this is not
 * integrity protection and not tamper detection. A same-uid writer can
 * still append well-formed claims or rewrite history (declared limit of
 * the whole store layer, tied to the execute_code boundary). On any
 * detected change the whole file is re-folded, which is safe because the
 * folds are idempotent (first-wins PUT, preconditioned claims).
 *
 * A torn final line (crash mid-append) is never folded and is retried on
 * the next read.
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

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const EMPTY: ReaderState = { dev: 0, ino: 0, offset: 0, tailBytes: 0, tailHash: '' };

/**
 * Read the new tail of `file` and invoke onLine per complete line, in
 * order. onReset fires BEFORE the first line whenever the file identity
 * or continuity changed (or no prior state exists): the caller must
 * discard its fold there and rebuild it purely from the lines that
 * follow. Returns the state to cache. Read failures other than ENOENT
 * throw: a read failure is never an empty log (fail closed).
 */
export function foldAppendedLines(
    file: string,
    prev: ReaderState | null,
    onReset: () => void,
    onLine: (line: string) => void,
    chunkBytes = 1024 * 1024
): ReaderState {
    let st: fs.Stats;
    try {
        st = fs.statSync(file);
    } catch (e: any) {
        if (e?.code === 'ENOENT') return prev ?? { ...EMPTY };
        throw e;
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
        if (reset) onReset();
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
                onLine(pending.subarray(0, nl).toString('utf8'));
                state.tailBytes = nl + 1;
                state.tailHash = sha(pending.subarray(0, nl + 1));
                pending = pending.subarray(nl + 1);
                nl = pending.indexOf(0x0a);
            }
        }
        state.offset = st.size - pending.length;
        return state;
    } finally {
        fs.closeSync(fd);
    }
}
