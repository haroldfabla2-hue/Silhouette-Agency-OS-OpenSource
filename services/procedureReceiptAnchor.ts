import type { SignedReceiptEntry } from './procedureReceiptSigner';

/**
 * External anchor for the signed receipt chain head.
 *
 * The hash chain inside the database proves nothing about tail truncation:
 * deleting the newest entries leaves a shorter chain that still verifies.
 * Anchoring the latest entry hash in a separate git repository (one commit
 * and tag per anchor) gives an outside record the operator can compare.
 *
 * This module only PRODUCES and VERIFIES the anchor content. Publishing it
 * (git commit/tag/push) is the operator's explicit action. Nothing here
 * writes to disk, runs git, or talks to the network.
 */
export interface ReceiptAnchor { v: 1; kind: 'RECEIPT-ANCHOR'; seq: number; entryHash: string; keyId: string }

const HEX64 = /^[0-9a-f]{64}$/;

/** Fixed key order so the anchored bytes are reproducible and diff cleanly. */
export function canonicalAnchor(a: ReceiptAnchor): string {
    return JSON.stringify({ v: a.v, kind: a.kind, seq: a.seq, entryHash: a.entryHash, keyId: a.keyId });
}

/** Anchor content for a chain-head entry. Pure function of the entry; no clock, no config. */
export function buildAnchor(entry: Pick<SignedReceiptEntry, 'seq' | 'entryHash' | 'keyId'>): string {
    if (!Number.isInteger(entry.seq) || entry.seq < 1) throw new Error('Anchor requires a positive integer seq');
    if (!HEX64.test(entry.entryHash)) throw new Error('Anchor requires a 64-char hex entry hash');
    if (!entry.keyId || typeof entry.keyId !== 'string') throw new Error('Anchor requires a signer key id');
    return canonicalAnchor({ v: 1, kind: 'RECEIPT-ANCHOR', seq: entry.seq, entryHash: entry.entryHash, keyId: entry.keyId });
}

/** Strict closed decoder: rejects unknown/missing fields, wrong types and non-canonical bytes. */
export function parseAnchor(content: string): ReceiptAnchor {
    let raw: unknown;
    try { raw = JSON.parse(content); } catch { throw new Error('Anchor is not valid JSON'); }
    const a = raw as Record<string, unknown>;
    if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new Error('Anchor must be a JSON object');
    const keys = Object.keys(a).sort();
    if (keys.join(',') !== 'entryHash,keyId,kind,seq,v') throw new Error('Anchor has missing or unknown fields');
    if (a.v !== 1 || a.kind !== 'RECEIPT-ANCHOR') throw new Error('Unsupported anchor version or kind');
    if (!Number.isInteger(a.seq) || (a.seq as number) < 1) throw new Error('Anchor seq must be a positive integer');
    if (typeof a.entryHash !== 'string' || !HEX64.test(a.entryHash)) throw new Error('Anchor entry hash must be 64-char hex');
    if (typeof a.keyId !== 'string' || !a.keyId) throw new Error('Anchor key id must be a non-empty string');
    const anchor: ReceiptAnchor = { v: 1, kind: 'RECEIPT-ANCHOR', seq: a.seq as number, entryHash: a.entryHash as string, keyId: a.keyId as string };
    if (canonicalAnchor(anchor) !== content) throw new Error('Anchor bytes are not canonical');
    return anchor;
}

/** True only when the stored anchor names exactly this chain head. A truncated or extended chain changes the head and fails. */
export function verifyAnchor(entry: Pick<SignedReceiptEntry, 'seq' | 'entryHash' | 'keyId'>, content: string): boolean {
    try {
        const a = parseAnchor(content);
        return a.seq === entry.seq && a.entryHash === entry.entryHash && a.keyId === entry.keyId;
    } catch { return false; }
}

/** Suggested repository-relative path for one anchor. One file per anchored head, never overwritten. */
export const anchorPath = (seq: number): string => `anchors/seq-${seq}.json`;

/**
 * The ONLY source of the anchor repository location: SILHOUETTE_RECEIPT_ANCHOR_REPO_URL.
 * There is deliberately no default: anchoring silently into the wrong repository is worse than failing.
 * Accepts an https URL or an scp-like git remote (git@host:path). Anything else throws.
 */
export function anchorRepoUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
    const url = (env.SILHOUETTE_RECEIPT_ANCHOR_REPO_URL ?? '').trim();
    if (!url) throw new Error('SILHOUETTE_RECEIPT_ANCHOR_REPO_URL is not set; no anchor repository is configured');
    if (/^https:\/\/[^\s/]+\.[^\s/]+\/[^\s]+\.git$/.test(url)) return url;
    if (/^git@[^\s:]+:[^\s]+\.git$/.test(url)) return url;
    throw new Error('SILHOUETTE_RECEIPT_ANCHOR_REPO_URL must be an https://...git or git@...:....git remote');
}
