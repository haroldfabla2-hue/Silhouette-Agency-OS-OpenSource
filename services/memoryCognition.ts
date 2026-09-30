import type { MemoryNode } from '../types';

export interface ActivationExplanation { score: number; base: number; salience: number; protected: boolean }
/** ACT-R inspired, deliberately not calibrated to a production corpus. Never authorizes deletion. */
export function activation(node: MemoryNode, now = Date.now(), decay = 0.5): ActivationExplanation {
    const accesses = ([node.timestamp, ...(node.significantAccesses || [])]).filter(t => t <= now).slice(-32);
    const base = Math.log(Math.max(Number.EPSILON, accesses.reduce((sum, t) => sum + Math.pow(Math.max(1, (now - t) / 3600000), -decay), 0)));
    const salience = Math.max(0, Math.min(1, node.importance));
    const protectedMemory = ['IDENTITY', 'SAFETY', 'CONFIRMED_PREFERENCE', 'OBLIGATION'].some(tag => node.tags.includes(tag));
    return { score: base + 2 * salience + (protectedMemory ? 10 : 0), base, salience, protected: protectedMemory };
}
/** Only explicit meaningful use records an access, with a one-hour rate limit. */
export function recordSignificantAccess(node: MemoryNode, now = Date.now()): MemoryNode {
    const accesses = node.significantAccesses || [];
    const latest = accesses.at(-1);
    if (latest !== undefined && now - latest < 3600000) return node;
    return { ...node, significantAccesses: [...accesses, now].slice(-32) };
}
export function selectSleepBatch(nodes: MemoryNode[], limit: number, now = Date.now()): MemoryNode[] {
    const ranked = [...nodes].sort((a, b) => activation(b, now).score - activation(a, now).score || a.id.localeCompare(b.id));
    const selected: MemoryNode[] = [];
    const signatures = new Set<string>();
    for (const node of ranked) {
        const signature = node.content.toLowerCase().replace(/\s+/g, ' ').trim();
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        selected.push(node);
        if (selected.length >= limit) break;
    }
    return selected;
}
export interface CitedClaim { text: string; parentIds: string[] }
/** Extractive verifier: allows exact evidence spans only, not an LLM claiming its own summary is true. */
export function verifyClaims(claims: CitedClaim[], sources: MemoryNode[]): boolean {
    const byId = new Map(sources.map(n => [n.id, n]));
    return claims.length > 0 && claims.every(claim => typeof claim?.text === 'string' && claim.text.trim().length > 0 && Array.isArray(claim.parentIds) && claim.parentIds.length > 0
        && claim.parentIds.every(id => byId.has(id))
        && claim.parentIds.some(id => byId.get(id)!.content.includes(claim.text)));
}
