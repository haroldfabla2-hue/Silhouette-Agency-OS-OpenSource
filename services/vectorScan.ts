import fs from 'node:fs';

/**
 * Pure-JS vector similarity over full table scans.
 *
 * Why this exists: @lancedb/lancedb's native vector kernels are compiled with
 * AVX instructions. On CPUs without AVX (for example the QEMU "Virtual CPU
 * version 2.5+" that runs the production server) every vectorSearch call dies
 * with SIGILL (exit 132) and takes the whole Node process down with it. Row
 * scans and writes do not touch those kernels, so a brute-force cosine scan in
 * JS is exact, portable and fast enough at memory scale (thousands of rows).
 */

export const DEFAULT_MAX_VECTOR_SCAN_ROWS = 100_000;

export function maxVectorScanRows(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.LANCEDB_SCAN_MAX_ROWS;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_VECTOR_SCAN_ROWS;
}

/** Cosine similarity, or null when the vectors are not comparable. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
    if (!a || !b || a.length !== b.length || a.length === 0) return null;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        const x = Number(a[i]);
        const y = Number(b[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        dot += x * y; na += x * x; nb += y * y;
    }
    if (na === 0 || nb === 0) return null;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type ScoredRow<T> = T & { _score: number };

/**
 * Coerces a LanceDB vector cell into a plain number[]. Scans return arrow
 * Vector objects (length is set but numeric indexing yields undefined), so
 * index-based access silently produces NaN; iteration or toArray() is the
 * reliable read. Returns null when the value cannot be read as numbers.
 */
export function toNumericArray(value: unknown): number[] | null {
    if (Array.isArray(value)) return value;
    if (value && typeof (value as { toArray?: unknown }).toArray === 'function') {
        try {
            const out = Array.from((value as { toArray: () => ArrayLike<number> }).toArray());
            if (out.length > 0) return out;
        } catch { /* fall through to iterator */ }
    }
    if (value && typeof (value as Iterable<number>)[Symbol.iterator] === 'function') {
        try {
            const out = Array.from(value as Iterable<number>);
            if (out.length > 0) return out;
        } catch { /* not readable */ }
    }
    return null;
}

/** Rank rows by cosine similarity against the query vector, best first. */
export function rankByCosine<T extends { vector: unknown }>(
    rows: readonly T[],
    queryVector: ArrayLike<number>,
    limit: number,
): ScoredRow<T>[] {
    const scored: ScoredRow<T>[] = [];
    for (const row of rows) {
        const vector = toNumericArray(row.vector);
        if (vector === null) continue;
        const score = cosineSimilarity(vector, queryVector);
        if (score !== null) scored.push(Object.assign({}, row, { _score: score }));
    }
    scored.sort((x, y) => y._score - x._score);
    return scored.slice(0, limit);
}

let kernelSupportCache: boolean | null = null;

/**
 * Preflight for code paths that still depend on LanceDB's native vector
 * kernels (ANN index training and ANN shadow search). Returns false on Linux
 * CPUs whose flags lack AVX, where those kernels die with SIGILL. Non-Linux
 * platforms (dev machines) are assumed capable; unreadable cpuinfo fails safe.
 */
export function cpuSupportsNativeVectorKernels(cpuinfoPath = '/proc/cpuinfo'): boolean {
    if (kernelSupportCache !== null && cpuinfoPath === '/proc/cpuinfo') return kernelSupportCache;
    let supported = true;
    if (process.platform === 'linux') {
        try {
            supported = /^flags\s*:.*[ \t]avx([ \t]|$)/m.test(fs.readFileSync(cpuinfoPath, 'utf8'));
        } catch {
            supported = false;
        }
    }
    if (cpuinfoPath === '/proc/cpuinfo') kernelSupportCache = supported;
    return supported;
}

/** Throws an actionable error when a native-kernel operation cannot run on this CPU. */
export function assertNativeVectorKernels(operation: string): void {
    if (!cpuSupportsNativeVectorKernels()) {
        throw new Error(
            `${operation} requires a CPU with AVX support: LanceDB native vector kernels crash ` +
            'with SIGILL otherwise. Exact JS scan search has no such requirement; use it instead.',
        );
    }
}
