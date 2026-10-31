/**
 * Memory audit for /v1/system/doctor (roadmap item 6).
 *
 * Six read-only checks over the memory system, identity files and the janitor
 * ledger. ETERNAL-MEMORY SAFE: this module only READS — it never deletes,
 * moves or rewrites anything. Every check reports exactly what it measured;
 * nothing is inferred beyond the data (e.g. duplicate detection is
 * normalized-exact, not embedding-semantic, and says so).
 */

import fs from 'fs';
import path from 'path';
import { MemoryNode } from '../../types';
import { SOUL_CORE_MARKERS, type IdentityLedgerEntry } from '../identity/identityEvolution';
import { RevisionLedger, type JanitorMetrics } from '../janitor/revisionLedger';
import { normalizeContent, MIN_DUP_CONTENT_LEN, isJanitorProcessed } from '../janitor/exactDuplicateSweep';

export interface AuditCheck {
    name: string;
    status: 'ok' | 'warning' | 'error';
    message: string;
    metadata?: Record<string, unknown>;
}

export interface SoulSnapshot {
    agentId: string;
    content: string | null;
    mtimeMs: number | null;
    ledger: IdentityLedgerEntry[];
}

export interface MemoryAuditDeps {
    /** Persistent-tier universe (LanceDB). The RAM tier is not included;
     *  checks that could false-positive on RAM-only ids say so. */
    nodes: MemoryNode[];
    souls: SoulSnapshot[];
    janitorMetrics: JanitorMetrics | null;
    now: number;
    /** Days without access before an important node counts as stagnant (default 30). */
    stagnantDays?: number;
    /** [NATIVE-RECOVERY] Journal entries not yet COMMITTED (null = unreadable). */
    pendingTransitions?: number | null;
    /** [NATIVE-RECOVERY] Canonical memories still EMBEDDING_PENDING (null = unreadable). */
    pendingEmbeddings?: number | null;
    /** [NATIVE-RECOVERY] Observable local quota-ledger state for the embedding model. */
    embeddingQuota?: { used: number; budget: number; day: string } | null;
    /** Journaled introspection concept writes not yet ACKed (null = unreadable). */
    pendingConceptWrites?: number | null;
}

// normalizeContent/MIN_DUP_CONTENT_LEN come from exactDuplicateSweep: single
// source of truth so the sweep consolidates exactly what this audit flags.
const normalize = normalizeContent;

const isDreamNode = (n: MemoryNode): boolean =>
    n.tags.some(t => /^(INTUITION|DREAM|intuition|dream)/.test(t));

export function runMemoryAudit(deps: MemoryAuditDeps): AuditCheck[] {
    const checks: AuditCheck[] = [];
    const stagnantMs = (deps.stagnantDays ?? 30) * 24 * 3600_000;

    // 1. Duplicate content (normalized-exact)
    const byNorm = new Map<string, MemoryNode[]>();
    for (const n of deps.nodes) {
        // Only UNRESOLVED duplicates warn: copies already marked SUPERSEDED
        // (by the janitor or the exact-duplicate sweep) point at their
        // canonical survivor and stay forever (eternal memory), so they are
        // resolved pointers, not pending duplicates.
        if (isJanitorProcessed(n)) continue;
        const key = normalize(n.content || '');
        if (key.length < MIN_DUP_CONTENT_LEN) continue; // too short to dedupe meaningfully
        const arr = byNorm.get(key) || [];
        arr.push(n);
        byNorm.set(key, arr);
    }
    const dupGroups = [...byNorm.values()].filter(g => g.length > 1);
    checks.push({
        name: 'Memory: duplicate content (normalized-exact)',
        status: dupGroups.length === 0 ? 'ok' : 'warning',
        message: dupGroups.length === 0
            ? `No unresolved duplicates across ${deps.nodes.length} persistent nodes`
            : `${dupGroups.length} unresolved duplicate group(s) across ${deps.nodes.length} nodes`,
        metadata: dupGroups.length ? {
            groups: dupGroups.length,
            sampleIds: dupGroups.slice(0, 5).map(g => g.map(n => n.id))
        } : undefined
    });

    // 2. Dream provenance: orphan intuitions + unprovenanced legacy
    const universe = new Set(deps.nodes.map(n => n.id));
    const dreamNodes = deps.nodes.filter(isDreamNode);
    const unprovenanced = dreamNodes.filter(n => !n.parentIds || n.parentIds.length === 0);
    const orphans = dreamNodes.filter(n =>
        n.parentIds && n.parentIds.length > 0 && n.parentIds.every(id => !universe.has(id)));
    checks.push({
        name: 'Memory: dream provenance',
        status: orphans.length === 0 ? 'ok' : 'warning',
        message: `${dreamNodes.length} dream node(s): ${orphans.length} orphan, ${unprovenanced.length} without parentIds (pre-provenance legacy)`,
        metadata: {
            dreamNodes: dreamNodes.length,
            orphans: orphans.slice(0, 5).map(n => n.id),
            unprovenanced: unprovenanced.length,
            note: 'Universe is the persistent tier; a parent id living only in RAM is reported as orphan until consolidated.'
        }
    });

    // 3. SOUL integrity + drift vs identity ledger (per agent)
    for (const soul of deps.souls) {
        if (soul.content === null) {
            checks.push({ name: `Memory: SOUL (${soul.agentId})`, status: 'error', message: 'SOUL.md missing' });
            continue;
        }
        const missing = SOUL_CORE_MARKERS.filter(m => !soul.content!.includes(m));
        const soulEntries = soul.ledger.filter(e => e.file === 'SOUL.md');
        const lastLogged = soulEntries.length
            ? Math.max(...soulEntries.map(e => Date.parse(e.timestamp) || 0)) : null;
        const drift = soul.mtimeMs !== null && (lastLogged === null || soul.mtimeMs > lastLogged + 1000);
        const status = missing.length > 0 ? 'error' : drift ? 'warning' : 'ok';
        checks.push({
            name: `Memory: SOUL (${soul.agentId})`,
            status,
            message: missing.length > 0
                ? `Core markers missing: ${missing.join(', ')}`
                : drift
                    ? 'SOUL.md modified after last logged identity change (manual edit or unlogged writer)'
                    : `Intact; ${soulEntries.length} logged change(s)`,
            metadata: {
                missingMarkers: missing.length ? missing : undefined,
                fileMtime: soul.mtimeMs ? new Date(soul.mtimeMs).toISOString() : null,
                lastLoggedChange: lastLogged ? new Date(lastLogged).toISOString() : null,
                loggedChanges: soulEntries.length
            }
        });
    }

    // 4. Tier health (persistent tiers present in the universe)
    const tierCounts = new Map<string, number>();
    for (const n of deps.nodes) tierCounts.set(n.tier, (tierCounts.get(n.tier) || 0) + 1);
    checks.push({
        name: 'Memory: tier health',
        status: deps.nodes.length === 0 ? 'warning' : 'ok',
        message: deps.nodes.length === 0
            ? 'Persistent memory is empty'
            : [...tierCounts.entries()].map(([t, c]) => `${t}:${c}`).join(' '),
        metadata: { tiers: Object.fromEntries(tierCounts), total: deps.nodes.length }
    });

    // 5. Stagnant evidence: important nodes never accessed
    const stagnant = deps.nodes.filter(n =>
        (n.importance ?? 0) >= 0.7 && (n.accessCount ?? 0) === 0 &&
        (deps.now - (n.timestamp || 0)) > stagnantMs);
    checks.push({
        name: 'Memory: stagnant evidence',
        status: stagnant.length === 0 ? 'ok' : 'warning',
        message: stagnant.length === 0
            ? 'No stagnant high-importance nodes'
            : `${stagnant.length} node(s) with importance>=0.7 never accessed for ${deps.stagnantDays ?? 30}+ days`,
        metadata: stagnant.length ? { count: stagnant.length, sampleIds: stagnant.slice(0, 5).map(n => n.id) } : undefined
    });

    // 6. Janitor metrics
    if (!deps.janitorMetrics) {
        checks.push({ name: 'Memory: janitor', status: 'warning', message: 'No janitor ledger found (janitor has not run yet or ledger unreadable)' });
    } else {
        const m = deps.janitorMetrics;
        const lastAgeH = m.lastRunTs ? Math.round((deps.now - m.lastRunTs) / 3600_000) : null;
        const status = m.errors > 0 ? 'error' : m.abstentionRate > 0.5 && (m.applied + m.abstained) >= 10 ? 'warning' : 'ok';
        checks.push({
            name: 'Memory: janitor',
            status,
            message: `${m.totalEntries} entries (${m.applied} applied, ${m.abstained} abstained, ${m.reverted} reverted, ${m.errors} errors)` +
                (lastAgeH !== null ? `; last run ${lastAgeH}h ago` : ''),
            metadata: { ...m, lastRunAgeHours: lastAgeH }
        });
    }

    // [NATIVE-RECOVERY] Memory-pipeline self-recovery visibility: these two
    // backlogs were invisible until external manual scans found them.
    if (deps.pendingTransitions !== undefined) {
        checks.push({
            name: 'Memory: transition journal outstanding',
            status: deps.pendingTransitions === null ? 'warning' : deps.pendingTransitions === 0 ? 'ok' : 'warning',
            message: deps.pendingTransitions === null
                ? 'Transition journal unreadable - outstanding count unknown (NOT the same as zero)'
                : deps.pendingTransitions === 0
                    ? 'No outstanding memory transitions (all journal entries COMMITTED)'
                    : `${deps.pendingTransitions} transition(s) outstanding - journal retained; periodic reconcile resumes them`,
            metadata: deps.pendingTransitions === null ? undefined : { outstanding: deps.pendingTransitions }
        });
    }
    if (deps.pendingConceptWrites !== undefined) {
        checks.push({
            name: 'Memory: concept-write journal outstanding',
            status: deps.pendingConceptWrites === null ? 'warning' : deps.pendingConceptWrites === 0 ? 'ok' : 'warning',
            message: deps.pendingConceptWrites === null
                ? 'Concept-write journal unreadable - outstanding count unknown (NOT the same as zero)'
                : deps.pendingConceptWrites === 0
                    ? 'No outstanding concept writes (journal fully ACKed)'
                    : `${deps.pendingConceptWrites} concept write(s) outstanding - journaled (SQLite, durable); periodic retry driver resumes them`,
            metadata: deps.pendingConceptWrites === null ? undefined : { outstanding: deps.pendingConceptWrites }
        });
    }
    if (deps.pendingEmbeddings !== undefined) {
        const q = deps.embeddingQuota;
        checks.push({
            name: 'Memory: embeddings pending',
            status: deps.pendingEmbeddings === null ? 'warning' : deps.pendingEmbeddings === 0 ? 'ok' : 'warning',
            message: deps.pendingEmbeddings === null
                ? 'Embedding-pending count unavailable - NOT the same as zero'
                : deps.pendingEmbeddings === 0
                    ? 'All canonical memories have vector projections'
                    : `${deps.pendingEmbeddings} memor(ies) awaiting embedding (scan cap 10000)` +
                      (q ? `; local quota ledger gemini embedding: ${q.used}/${q.budget} attempts used (day ${q.day})` : ''),
            metadata: deps.pendingEmbeddings === null ? undefined : { pending: deps.pendingEmbeddings, embeddingQuota: q ?? undefined }
        });
    }

    return checks;
}

/** Gather real deps from the live system (used by the doctor route). */
export async function collectMemoryAuditDeps(): Promise<MemoryAuditDeps> {
    const { lancedbService } = await import('../lancedbService');
    let nodes: MemoryNode[] = [];
    try { nodes = await lancedbService.getAllNodes(); } catch { nodes = []; }

    // SOUL snapshots for every agent directory (data/agents/*, excluding 'definitions')
    const souls: SoulSnapshot[] = [];
    const agentsDir = path.resolve(process.cwd(), 'data', 'agents');
    try {
        for (const agentId of fs.readdirSync(agentsDir)) {
            if (agentId === 'definitions') continue;
            const dir = path.join(agentsDir, agentId);
            if (!fs.statSync(dir).isDirectory()) continue;
            const soulPath = path.join(dir, 'SOUL.md');
            let content: string | null = null;
            let mtimeMs: number | null = null;
            try {
                content = fs.readFileSync(soulPath, 'utf-8');
                mtimeMs = fs.statSync(soulPath).mtimeMs;
            } catch { /* missing SOUL reported as error by the check */ }
            let ledger: IdentityLedgerEntry[] = [];
            try {
                const lp = path.join(dir, 'identity-ledger.jsonl');
                if (fs.existsSync(lp)) {
                    ledger = fs.readFileSync(lp, 'utf-8').split('\n')
                        .filter(l => l.trim()).map(l => JSON.parse(l) as IdentityLedgerEntry);
                }
            } catch { /* unreadable ledger → treated as empty */ }
            souls.push({ agentId, content, mtimeMs, ledger });
        }
    } catch { /* no agents dir → no soul checks */ }

    let janitorMetrics: JanitorMetrics | null = null;
    try {
        const ledger = new RevisionLedger(path.resolve(process.cwd(), 'data', 'janitor-ledger.jsonl'));
        const m = ledger.metrics();
        if (m.totalEntries > 0) janitorMetrics = m;
    } catch { janitorMetrics = null; }

    // [NATIVE-RECOVERY] Outstanding journal transitions (COMMITTED history is
    // skipped - the journal is eternal and re-reading it whole every doctor
    // call would grow without bound).
    let pendingTransitions: number | null = null;
    try {
        const { memoryTransitions } = await import('../memoryTransitions');
        const { isOutstandingTransition } = await import('../memoryTransitions');
        pendingTransitions = (await memoryTransitions.pending()).filter(isOutstandingTransition).length;
    } catch { pendingTransitions = null; }

    let pendingEmbeddings: number | null = null;
    try { pendingEmbeddings = (await lancedbService.pendingEmbeddings(10000)).length; }
    catch { pendingEmbeddings = null; }

    let pendingConceptWrites: number | null = null;
    try {
        const { introspection } = await import('../introspectionEngine');
        pendingConceptWrites = introspection.getPendingContinuumWriteCount();
    } catch { pendingConceptWrites = null; }

    let embeddingQuota: { used: number; budget: number; day: string } | null = null;
    try {
        const { quotaLedger } = await import('../quotaLedger');
        const { DEFAULT_GEMINI_EMBEDDING_MODEL } = await import('../llm/defaultModels');
        embeddingQuota = quotaLedger.status('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
    } catch { embeddingQuota = null; }

    return { nodes, souls, janitorMetrics, now: Date.now(), pendingTransitions, pendingEmbeddings, embeddingQuota, pendingConceptWrites };
}
