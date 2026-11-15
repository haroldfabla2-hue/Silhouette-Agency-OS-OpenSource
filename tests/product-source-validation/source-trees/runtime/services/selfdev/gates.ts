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

export interface CycleEdit { find: string; replace: string }

/**
 * Apply anchored edits to a file's content. Each find must match the current
 * content EXACTLY ONCE: zero matches means the anchor hallucinated, more than
 * one means it is ambiguous - both are honest failures, never a best-effort
 * guess. This is the proven edit format for weak planner models: no line
 * numbers, no diff syntax, context-verified by construction.
 */
export function applyCycleEdits(original: string, edits: CycleEdit[]): string {
    let content = original;
    for (const e of edits) {
        if (!e || typeof e.find !== 'string' || e.find.length === 0) throw new Error('edit find must be a non-empty string');
        if (typeof e.replace !== 'string') throw new Error('edit replace must be a string');
        const first = content.indexOf(e.find);
        if (first === -1) throw new Error('edit anchor not found in current file');
        if (content.indexOf(e.find, first + 1) !== -1) throw new Error('edit anchor is ambiguous (matches more than once)');
        content = content.slice(0, first) + e.replace + content.slice(first + e.find.length);
    }
    return content;
}
