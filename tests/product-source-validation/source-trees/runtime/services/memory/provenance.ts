/**
 * Memory Provenance — who said what, always.
 *
 * Every memory write in the system carries a reserved `source:*` tag naming
 * WHO produced the content. Retrieval attributes and filters by that tag,
 * never by guessing from content or from legacy namespace tags.
 *
 * The design rule (user requirement): introspection is the entity narrating
 * ITS OWN thoughts in first person ("me está doliendo la pierna"). It must
 * never be confused with what the user said or with what other agents said.
 */

export enum MemorySource {
    USER_SAID = 'USER_SAID',               // verbatim from the user
    ASSISTANT_SAID = 'ASSISTANT_SAID',     // the entity's own voice (chat responses)
    INTROSPECTION = 'INTROSPECTION',       // the entity's own thoughts (narrator epiphanies)
    AGENT = 'AGENT',                       // another agent: source:AGENT:<name>
    SYSTEM = 'SYSTEM',                     // system events/logs
}

export const SOURCE_TAG_PREFIX = 'source:';

export const sourceTag = (source: string): string => `${SOURCE_TAG_PREFIX}${source}`;

export const agentSourceTag = (agentName: string): string => `${SOURCE_TAG_PREFIX}${MemorySource.AGENT}:${agentName}`;

/** Extract the provenance value from a tag set ('AGENT:narrator' stays whole). */
export function parseSource(tags?: string[]): string | null {
    const t = tags?.find(t => t.startsWith(SOURCE_TAG_PREFIX));
    return t ? t.slice(SOURCE_TAG_PREFIX.length) : null;
}

/**
 * Self-generated content: the entity's own utterances and thoughts.
 * Curated knowledge entries (tags 'FACT' or 'user_fact') are NOT excluded:
 * they carry their own stated/inferred label and remain useful context.
 */
export function isSelfGenerated(tags?: string[]): boolean {
    const src = parseSource(tags);
    if (src === MemorySource.ASSISTANT_SAID || src === MemorySource.INTROSPECTION) {
        const curated = tags?.includes('FACT') || tags?.includes('user_fact');
        return !curated;
    }
    return false;
}

/** True when the user is explicitly asking about the entity's own words/thoughts. */
export function wantsSelfIncluded(query: string): boolean {
    return /qu[eé]\s+(te\s+)?(dijiste|respondiste|pensaste)|tus?\s+(pensamientos|palabras|respuestas)|your\s+(thoughts|words)|what\s+did\s+you\s+(say|think)|introspecci/i.test(query);
}

/**
 * Default chat-context rule: self-generated raw content stays OUT unless the
 * user explicitly asks for it. The entity must not re-ingest its own voice as
 * if it were neutral memory.
 */
export function shouldExcludeFromChat(tags: string[] | undefined, includeSelf: boolean): boolean {
    if (includeSelf) return false;
    return isSelfGenerated(tags);
}

/**
 * Attribution label from provenance. Falls back to the legacy tag heuristic
 * for entries written before this vocabulary existed.
 */
export function speakerLabel(tags?: string[]): string {
    // Curated inference about the user is labeled as inference, never as user speech.
    if (tags?.includes('USER_INFERRED')) return 'Silhouette inferred (unverified)';
    if (tags?.includes('USER_STATED')) return 'USER said';

    const src = parseSource(tags);
    if (src) {
        if (src === MemorySource.USER_SAID) return 'USER said';
        if (src === MemorySource.ASSISTANT_SAID) return 'ASSISTANT said';
        if (src === MemorySource.INTROSPECTION) return 'SILHOUETTE thought (introspection)';
        if (src === MemorySource.SYSTEM) return 'System recorded';
        if (src.startsWith(MemorySource.AGENT + ':')) return `Agent ${src.slice(6)} reported`;
        if (src === MemorySource.AGENT) return 'An agent reported';
    }

    // Legacy fallback (pre-provenance entries)
    if (tags?.includes('user') || tags?.includes('USER_MESSAGE') || tags?.includes('chat')) return 'USER said';
    return 'Memory';
}
