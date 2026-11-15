/**
 * Balanced-brace extraction of [EXECUTE: name {json}] markers.
 * Regex extraction (\{.*?\}) truncates at the first inner '}' and corrupts
 * nested args; this scanner respects nesting and string literals. Markers are
 * emitted by the native-tool-call translation in streamAdapters and by some
 * models directly.
 */
export interface ExecMarker {
    name: string;
    args: Record<string, unknown>;
    originalMatch: string;
}

const MARKER = /\[EXECUTE:\s*([\w.]+)\s*/g;

/**
 * Providers namespace their native tool names (gpt-oss emits "tool.write_file").
 * Strip the well-known prefixes so the pipeline resolves the registry name.
 */
export function normalizeToolName(name: string): string {
    return name.replace(/^(tool|tools|functions)\./, '');
}

export function extractExecuteMarkers(text: string): ExecMarker[] {
    const out: ExecMarker[] = [];
    MARKER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER.exec(text)) !== null) {
        const name = m[1];
        let i = m.index + m[0].length;
        if (text[i] !== '{') continue;
        const start = i;
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (; i < text.length; i++) {
            const ch = text[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) { i++; break; }
            }
        }
        if (depth !== 0) continue; // unbalanced: not a complete marker
        const jsonText = text.slice(start, i);
        if (text[i] !== ']') continue;
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(jsonText);
        } catch {
            continue; // invalid JSON: skip the marker, never half-execute
        }
        out.push({ name, args, originalMatch: text.slice(m.index, i + 1) });
    }
    return out;
}
