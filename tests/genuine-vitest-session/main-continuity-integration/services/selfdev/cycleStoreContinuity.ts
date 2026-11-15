import fs from 'node:fs';
import path from 'node:path';

/** Fail-closed continuity check only. This does not replay or repair state,
 * clear an operator hold, prove a cycle safe, or authorize any execution.
 * The returned bytes still require the cycle service's schema validation. */
export function readCycleStateOrPristine(dir: string): string | null {
    const state = path.join(dir, 'cycles.json');
    const requireRegular = (file: string): fs.Stats | null => {
        try {
            const entry = fs.lstatSync(file);
            if (!entry.isFile() || entry.nlink !== 1) throw new Error('Cycle state requires an unshared regular file');
            return entry;
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
    };
    if (requireRegular(state)) return fs.readFileSync(state, 'utf8');
    // A prior state quarantine, journal, request, result or other state evidence
    // means absence is not a first start. Do not silently manufacture empty state.
    const permittedEmptyDirectories = new Set(['pr-requests', 'pr-results']);
    for (const name of fs.readdirSync(dir)) {
        const candidate = path.join(dir, name);
        const entry = fs.lstatSync(candidate);
        if (!permittedEmptyDirectories.has(name) || !entry.isDirectory()
            || fs.readdirSync(candidate).length !== 0) {
            throw new Error('SELFDEV_CONTINUITY_UNKNOWN: cycles.json absent with prior state evidence; operator recovery required');
        }
    }
    return null;
}

/** Reject the corrupt snapshot without renaming or overwriting it. The same
 * evidence then blocks every restart instead of letting the second boot look
 * pristine. Unknown future schemas fail closed until reviewed migration. */
export function parseCycleStore<T extends { cycles: unknown[] }>(raw: string): T {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as T).cycles)) {
        throw new Error('SELFDEV_CONTINUITY_UNKNOWN: invalid cycle store; original bytes preserved');
    }
    const states = new Set(['PROPOSAL_PENDING', 'PLANNED', 'ATTEMPTED', 'EXECUTED', 'VERIFIED',
        'PR_SUBMITTED', 'PR_OPEN', 'FAILED', 'REJECTED', 'ABANDONED']);
    const ids = new Set<string>();
    for (const value of (parsed as T).cycles) {
        if (!value || typeof value !== 'object') throw new Error('SELFDEV_CONTINUITY_UNKNOWN: invalid cycle entry');
        const c = value as Record<string, unknown>;
        if (typeof c.id !== 'string' || !c.id || ids.has(c.id)
            || typeof c.state !== 'string' || !states.has(c.state)) {
            throw new Error('SELFDEV_CONTINUITY_UNKNOWN: invalid cycle identity/state; original bytes preserved');
        }
        // Preserve legacy issue/scope/date/payload bytes without coercion or
        // inventing defaults. This continuity cut validates only identity/state,
        // which admission needs to avoid forgetting active work. Action-specific
        // validation/migration remains a separate concern.
        ids.add(c.id);
    }
    return parsed as T;
}
