// Tokenized lexical matching shared by the in-RAM and Qdrant text paths of memory search.
// Before: the WHOLE query had to appear as one contiguous substring, so "alberto espanol" never matched
// "Alberto prefiere espanol". Now every query token must appear (any order, accents/case ignored),
// and an exact contiguous phrase still ranks higher.

/** Lowercase, strip diacritics, split on anything that is not a letter or digit. */
export function tokenize(text: string): string[] {
    return (text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
}

function normalizeFlat(text: string): string {
    return tokenize(text).join(' ');
}

/**
 * 0 = no match. Otherwise >0: every query token occurs in the content (as a word prefix or substring),
 * +1 if the normalized query occurs contiguously, +coverage of whole-word hits (0..1) as tie-breaker.
 */
export function lexicalScore(content: string, query: string): number {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return 0;
    const flat = normalizeFlat(content);
    if (!flat) return 0;
    const words = new Set(flat.split(' '));
    let wholeWord = 0;
    for (const t of qTokens) {
        if (!flat.includes(t)) return 0; // AND semantics: a missing token means no match
        if (words.has(t)) wholeWord++;
    }
    const phrase = flat.includes(qTokens.join(' ')) ? 1 : 0;
    return 1 + phrase + wholeWord / qTokens.length;
}

export function lexicalMatches(content: string, query: string): boolean {
    return lexicalScore(content, query) > 0;
}
