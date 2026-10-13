/**
 * IDENTITY EVOLUTION — versioned, auditable identity changes.
 *
 * Every change to an agent's IDENTITY.md or SOUL.md flows through this
 * service. Nothing about who the entity is may change silently:
 *
 * - Every write is versioned (v1, v2, ...) with the previous content snapshotted.
 * - Every change appends to an append-only JSONL ledger with the reason, the
 *   source reflection that motivated it, who applied it, and before/after hashes.
 * - Every change is rendered into a human-readable IDENTITY_HISTORY.md.
 * - Introspection-driven adjustments pass through guards: core markers must
 *   survive, and one adjustment touches at most one section.
 *
 * No claim of consciousness: introspection proposes documented adjustments to
 * values/tone/style; the ledger makes the evolution visible and reversible.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

export type IdentityFile = 'IDENTITY.md' | 'SOUL.md';

/** Minimal I/O surface this service needs from the agent file system (injectable for tests). */
export interface IdentityIO {
    read(agentId: string, file: IdentityFile): string;
    write(agentId: string, file: IdentityFile, content: string): void;
    getAgentDir(agentId: string): string;
}

export interface IdentityGuardOptions {
    /** Substrings that must still be present after the change (exact match). */
    requiredMarkers?: string[];
    /** Maximum fraction of markdown sections the change may touch (0..1). */
    maxTouchedSectionRatio?: number;
}

export interface IdentityChangeRequest {
    agentId: string;
    file: IdentityFile;
    newContent: string;
    /** Why this change happens. Required, never empty: the ledger is the audit trail. */
    rationale: string;
    /** The introspection/reflection text that motivated the change, when applicable. */
    sourceReflection?: string;
    /** Who applied it: 'user', 'personalizeAgent', 'updateSoul', 'introspection:SOUL_ADJUST', ... */
    appliedBy: string;
    guard?: IdentityGuardOptions;
}

export interface IdentityLedgerEntry {
    version: number;
    timestamp: string;
    agentId: string;
    file: IdentityFile;
    hashBefore: string | null;
    hashAfter: string;
    diffSummary: string;
    rationale: string;
    sourceReflection: string | null;
    appliedBy: string;
    snapshotPath: string | null;
}

export type IdentityEvolutionErrorCode = 'invalid-input' | 'no-change' | 'guard-violation';

export class IdentityEvolutionError extends Error {
    constructor(public readonly code: IdentityEvolutionErrorCode, message: string) {
        super(message);
        this.name = 'IdentityEvolutionError';
    }
}

/** Core structure of a soul that no introspection-driven adjustment may remove. */
export const SOUL_CORE_MARKERS = ['# Soul:', '## Personality', '## Core Values', '## Communication Style', '## Principles'];

/**
 * Engine-sourced adjustments (dreamer/curiosity/research evidence) may not
 * exceed this many per agent per day. Evolution is gradual by design.
 */
export const MAX_ENGINE_ADJUSTMENTS_PER_DAY = 3;

/** Guards for adjustments proposed by introspection: core survives, one section at a time. */
export const INTROSPECTION_GUARDS: IdentityGuardOptions = {
    requiredMarkers: SOUL_CORE_MARKERS,
    maxTouchedSectionRatio: 0.34
};

const LEDGER_FILE = 'identity-ledger.jsonl';
const HISTORY_FILE = 'IDENTITY_HISTORY.md';
const SNAPSHOT_DIR = 'identity-history';

function sha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Section titles of a markdown document ('## X' and '# X' headings). */
function sectionTitles(content: string): string[] {
    return content.split('\n').filter(l => /^#{1,2} /.test(l)).map(l => l.trim());
}

/**
 * Human-readable one-line summary of what changed between two versions:
 * added/removed/modified sections plus line delta.
 */
export function diffSummary(before: string, after: string): string {
    const beforeSections = sectionTitles(before);
    const afterSections = sectionTitles(after);
    const added = afterSections.filter(s => !beforeSections.includes(s));
    const removed = beforeSections.filter(s => !afterSections.includes(s));
    const beforeLines = before.split('\n').length;
    const afterLines = after.split('\n').length;
    const parts: string[] = [];
    if (added.length) parts.push(`sections added: ${added.join(', ')}`);
    if (removed.length) parts.push(`sections removed: ${removed.join(', ')}`);
    if (!added.length && !removed.length) parts.push('same sections, content edited');
    parts.push(`lines ${beforeLines} → ${afterLines}`);
    return parts.join('; ');
}

/** Fraction of sections whose content differs or that were added/removed. */
function touchedSectionRatio(before: string, after: string): number {
    const splitSections = (content: string): Map<string, string> => {
        const map = new Map<string, string>();
        let current = '(preamble)';
        map.set(current, '');
        for (const line of content.split('\n')) {
            if (/^#{1,2} /.test(line)) { current = line.trim(); if (!map.has(current)) map.set(current, ''); }
            map.set(current, map.get(current) + line + '\n');
        }
        return map;
    };
    const a = splitSections(before);
    const b = splitSections(after);
    const keys = new Set([...a.keys(), ...b.keys()]);
    if (keys.size === 0) return 0;
    let touched = 0;
    for (const k of keys) if (a.get(k) !== b.get(k)) touched++;
    return touched / keys.size;
}

/** Replace one '## Section' block (heading included) inside a markdown document. */
export function replaceSection(document: string, sectionHeading: string, newSectionContent: string): string {
    const lines = document.split('\n');
    const start = lines.findIndex(l => l.trim() === sectionHeading.trim());
    if (start < 0) throw new IdentityEvolutionError('invalid-input', `Section not found: ${sectionHeading}`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^#{1,2} /.test(lines[i])) { end = i; break; }
    }
    const replacement = newSectionContent.replace(/\n+$/, '').split('\n');
    return [...lines.slice(0, start), ...replacement, ...lines.slice(end)].join('\n');
}

export function createIdentityEvolution(io: IdentityIO) {

    function ledgerPath(agentId: string): string {
        return path.join(io.getAgentDir(agentId), LEDGER_FILE);
    }

    function readLedger(agentId: string): IdentityLedgerEntry[] {
        const p = ledgerPath(agentId);
        if (!fs.existsSync(p)) return [];
        return fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim())
            .map(l => JSON.parse(l) as IdentityLedgerEntry);
    }

    function nextVersion(agentId: string, file: IdentityFile): number {
        const versions = readLedger(agentId).filter(e => e.file === file).map(e => e.version);
        return versions.length ? Math.max(...versions) + 1 : 1;
    }

    function assertGuards(before: string, req: IdentityChangeRequest): void {
        const guard = req.guard;
        if (!guard) return;
        if (guard.requiredMarkers) {
            const missing = guard.requiredMarkers.filter(m => !req.newContent.includes(m));
            if (missing.length) {
                throw new IdentityEvolutionError('guard-violation',
                    `Change rejected: core markers would be lost: ${missing.join(', ')}`);
            }
        }
        if (guard.maxTouchedSectionRatio !== undefined) {
            const ratio = touchedSectionRatio(before, req.newContent);
            if (ratio > guard.maxTouchedSectionRatio) {
                throw new IdentityEvolutionError('guard-violation',
                    `Change rejected: touches ${(ratio * 100).toFixed(0)}% of sections (max ${guard.maxTouchedSectionRatio * 100}%)`);
            }
        }
    }

    /**
     * Apply a versioned identity change. This is the ONLY way identity files
     * may be written once an agent exists.
     */
    function applyVersionedChange(req: IdentityChangeRequest): IdentityLedgerEntry {
        if (!req.agentId?.trim() || !req.rationale?.trim() || !req.appliedBy?.trim()) {
            throw new IdentityEvolutionError('invalid-input', 'agentId, rationale and appliedBy are required');
        }
        if (typeof req.newContent !== 'string' || !req.newContent.trim()) {
            throw new IdentityEvolutionError('invalid-input', 'newContent must be non-empty');
        }

        const before = io.read(req.agentId, req.file);
        if (before === req.newContent) {
            throw new IdentityEvolutionError('no-change', 'New content is identical to the current version');
        }
        assertGuards(before, req);

        const version = nextVersion(req.agentId, req.file);
        const dir = io.getAgentDir(req.agentId);
        const snapshotDir = path.join(dir, SNAPSHOT_DIR);
        fs.mkdirSync(snapshotDir, { recursive: true });

        let snapshotPath: string | null = null;
        if (before) {
            snapshotPath = path.join(SNAPSHOT_DIR, `${req.file.replace('.md', '')}.v${version}.md`);
            fs.writeFileSync(path.join(dir, snapshotPath), before, 'utf-8');
        }

        io.write(req.agentId, req.file, req.newContent);

        const entry: IdentityLedgerEntry = {
            version,
            timestamp: new Date().toISOString(),
            agentId: req.agentId,
            file: req.file,
            hashBefore: before ? sha256(before) : null,
            hashAfter: sha256(req.newContent),
            diffSummary: diffSummary(before, req.newContent),
            rationale: req.rationale.trim(),
            sourceReflection: req.sourceReflection?.trim() || null,
            appliedBy: req.appliedBy,
            snapshotPath
        };
        fs.appendFileSync(ledgerPath(req.agentId), JSON.stringify(entry) + '\n', 'utf-8');

        const historyEntry = [
            `## v${version} — ${entry.timestamp} (${entry.file})`,
            `- Applied by: ${entry.appliedBy}`,
            `- Reason: ${entry.rationale}`,
            entry.sourceReflection ? `- Source reflection: ${entry.sourceReflection}` : null,
            `- Diff: ${entry.diffSummary}`,
            `- Hash: ${entry.hashBefore ?? '∅'} → ${entry.hashAfter}`,
            entry.snapshotPath ? `- Previous version: ${entry.snapshotPath}` : null,
            ''
        ].filter(l => l !== null).join('\n');
        fs.appendFileSync(path.join(dir, HISTORY_FILE), historyEntry + '\n', 'utf-8');

        systemBus.emit(SystemProtocol.IDENTITY_EVOLVED, {
            agentId: entry.agentId,
            file: entry.file,
            version: entry.version,
            appliedBy: entry.appliedBy,
            rationale: entry.rationale
        }, 'IDENTITY_EVOLUTION');

        return entry;
    }

    /**
     * Introspection entry point: a reflection proposes adjusting ONE section of
     * the soul. Core markers must survive; the reflection is recorded as the source.
     */
    function applyIntrospectionAdjustment(params: {
        agentId: string;
        sectionHeading: string;
        newSectionContent: string;
        rationale: string;
        sourceReflection: string;
        /** Where the proposal's evidence came from. Engines feed introspection;
         *  every non-reflection origin is rate-limited per day and recorded. */
        originEngine?: 'reflection' | 'dreamer' | 'curiosity' | 'research';
    }): IdentityLedgerEntry {
        const origin = params.originEngine ?? 'reflection';
        if (!['reflection', 'dreamer', 'curiosity', 'research'].includes(origin)) {
            throw new IdentityEvolutionError('invalid-input', `Unknown originEngine: ${origin}`);
        }
        if (origin !== 'reflection') {
            const today = new Date().toISOString().slice(0, 10);
            const engineToday = readLedger(params.agentId).filter(e =>
                e.timestamp.startsWith(today) && /^introspection:SOUL_ADJUST:(dreamer|curiosity|research)$/.test(e.appliedBy)
            ).length;
            if (engineToday >= MAX_ENGINE_ADJUSTMENTS_PER_DAY) {
                throw new IdentityEvolutionError(
                    'guard-violation',
                    `Engine-sourced identity evolution is rate-limited to ${MAX_ENGINE_ADJUSTMENTS_PER_DAY}/day per agent (gradual self-discovery, never runaway change)`
                );
            }
        }
        const current = io.read(params.agentId, 'SOUL.md');
        if (!current) throw new IdentityEvolutionError('invalid-input', `Agent ${params.agentId} has no SOUL.md`);
        const newContent = replaceSection(current, params.sectionHeading, params.newSectionContent);
        return applyVersionedChange({
            agentId: params.agentId,
            file: 'SOUL.md',
            newContent,
            rationale: params.rationale,
            sourceReflection: params.sourceReflection,
            appliedBy: origin === 'reflection' ? 'introspection:SOUL_ADJUST' : `introspection:SOUL_ADJUST:${origin}`,
            guard: INTROSPECTION_GUARDS
        });
    }

    /** Full audit trail for an agent, oldest first. */
    function getHistory(agentId: string): IdentityLedgerEntry[] {
        return readLedger(agentId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    return { applyVersionedChange, applyIntrospectionAdjustment, getHistory };
}

export type IdentityEvolution = ReturnType<typeof createIdentityEvolution>;
