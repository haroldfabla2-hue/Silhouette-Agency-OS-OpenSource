/**
 * Pure instruction -> element matcher (no browser needed, fully testable).
 * - Whitespace tokenization (the old code used a double-escaped regex that never split).
 * - Numbers only select an element id when written as "#4", "element 4", "id 4" or "number 4";
 *   "click 2nd result" or "type 12345" are not ids.
 * - Ties for the best score are reported as AMBIGUOUS instead of silently picking the first.
 */
export interface MatchableElement {
    id: number;
    tag: string;
    text: string;
    ariaLabel?: string;
    placeholder?: string;
}

export interface MatchResult<T extends MatchableElement> {
    element: T | null;
    ambiguous: boolean;
    candidates: T[];
}

export function matchInstruction<T extends MatchableElement>(instruction: string, elements: T[]): MatchResult<T> {
    const normalized = instruction.toLowerCase();

    const idMatch = normalized.match(/(?:#|\b(?:element|id|number|elemento|n[uú]mero)\s+)(\d+)\b/);
    if (idMatch) {
        const found = elements.find(e => e.id === parseInt(idMatch[1], 10));
        if (found) return { element: found, ambiguous: false, candidates: [found] };
    }

    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    const scored = elements.map(el => {
        const elText = (el.text || '').toLowerCase();
        const aria = (el.ariaLabel || '').toLowerCase();
        const ph = (el.placeholder || '').toLowerCase();
        let score = 0;
        for (const word of words) {
            if (elText.includes(word)) score += 3;
            if (aria.includes(word)) score += 4;
            if (ph.includes(word)) score += 3;
        }
        if (score > 0) {
            if (normalized.includes('button') && el.tag === 'button') score += 2;
            if (normalized.includes('input') && el.tag === 'input') score += 2;
            if (normalized.includes('link') && el.tag === 'a') score += 2;
        }
        return { el, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { element: null, ambiguous: false, candidates: [] };
    const top = scored[0].score;
    const tied = scored.filter(s => s.score === top).map(s => s.el);
    if (tied.length > 1) return { element: null, ambiguous: true, candidates: tied.slice(0, 5) };
    return { element: scored[0].el, ambiguous: false, candidates: [scored[0].el] };
}
