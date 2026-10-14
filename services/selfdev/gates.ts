/**
 * SELF-DEV ACCEPTANCE GATES - Fase 1 hard requirement (Alberto/parent, 2026-10-14).
 * VERIFIED must mean correct. A cycle whose patch escapes its declared scope,
 * guts its target file, breaks typechecking, or breaks the routes it touches
 * is FAILED - no matter what the narrow acceptance test says.
 */

export interface GateOp { path: string; content: string }

export interface GateFailure { gate: 'scope' | 'shrink'; detail: string }

/** Every op must stay inside the cycle's declared scope. */
export function checkScope(ops: GateOp[], scope: string[]): GateFailure | null {
    for (const o of ops) {
        const inside = scope.some(s => o.path === s || o.path.startsWith(s.endsWith('/') ? s : s + '/'));
        if (!inside) {
            return { gate: 'scope', detail: `op touches ${o.path} outside declared scope (${scope.join(', ')})` };
        }
    }
    return null;
}

/**
 * A single op may not delete more than MAX_DELETE_RATIO of an existing file.
 * Planner models occasionally rewrite a whole file when asked for a small
 * change; that is how a "add one field" issue became "delete the cycles API".
 */
export const MAX_DELETE_RATIO = 0.5;

export function checkShrink(ops: GateOp[], readOriginal: (path: string) => string | null, maxRatio: number = MAX_DELETE_RATIO): GateFailure | null {
    for (const o of ops) {
        const original = readOriginal(o.path);
        if (original === null) continue; // new file: nothing to shrink
        const oldLines = original.split('\n').length;
        const newLines = o.content.split('\n').length;
        if (oldLines >= 20 && newLines < oldLines * (1 - maxRatio)) {
            return {
                gate: 'shrink',
                detail: `op deletes >${Math.round(maxRatio * 100)}% of ${o.path} (${oldLines} -> ${newLines} lines)`
            };
        }
    }
    return null;
}
