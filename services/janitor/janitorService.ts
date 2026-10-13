/**
 * Janitor Truth Evaluation Engine (v2) — the REAL janitor, replacing the
 * 12h placeholder slot in unifiedDaemon (runJanitorTask).
 *
 * Original design intent (README.md:134-135, commit 3b4590b, 2026-03-01):
 * detect contradictions in memory and resolve them into a singular meta-truth.
 * The original never ran (zero callers in git history) and violated the
 * eternal-memory constraint by hard-deleting superseded nodes.
 *
 * v2 design, grounded in the 2025-26 state of the art:
 *   - BELIEFMEM (EMNLP 2026): AGM belief revision; 4 actions EXP/REV/DUP/CON;
 *     "the store never deletes; superseded beliefs are retained with
 *     predecessor pointers"; serve the head by default (full chains hurt).
 *   - Kumiho (arXiv 2603.17244): immutable revisions + mutable tag pointers;
 *     circuit breakers, dry-run validation, auditable cursor-based resumption.
 *   - Zep/Graphiti (arXiv 2501.13956): temporal invalidation, never deletion.
 *
 * Safety-critical layers (aviation/banking defense-in-depth):
 *   0. Structural: this module contains NO delete path (CI-enforced by
 *      tests/automated/janitor-truth-engine.test.ts).
 *   1. Conservative detection: confidence threshold + abstention as the
 *      default action when anything is uncertain.
 *   2. Independent verifier: a SECOND provider must agree (N-version
 *      programming); disagreement => abstain + ledger.
 *   3. Dry-run by default: proposals are recorded, nothing is applied,
 *      until JANITOR_DRY_RUN=false is set deliberately.
 *   4. Observability: append-only ledger + metrics for /doctor.
 *   5. Deferred audit: entries carry detector+verifier provenance so a later
 *      pass with a different model can re-check them.
 *   6. Full reversibility: unsupersede() rolls back any marking.
 *
 * ETERNAL-MEMORY INVARIANT: this module never deletes, overwrites or
 * truncates a memory original. Superseded nodes keep their full content;
 * they only gain tags (SUPERSEDED, SUPERSEDED_BY:<id>).
 */

import crypto from 'crypto';
import { MemoryNode, MemoryTier } from '../../types';
import { RevisionLedger, JanitorAction, RevisionLedgerEntry, JanitorMetrics, defaultLedgerPath } from './revisionLedger';

// ---------------------------------------------------------------------------
// Configuration (env-overridable; safe defaults)
// ---------------------------------------------------------------------------

export interface JanitorConfig {
    dryRun: boolean;                 // JANITOR_DRY_RUN, default true
    windowHours: number;             // JANITOR_WINDOW_HOURS, default 48
    similarityThreshold: number;     // JANITOR_SIMILARITY_THRESHOLD, default 0.75
    confidenceThreshold: number;     // JANITOR_CONFIDENCE_THRESHOLD, default 0.8
    maxCandidates: number;           // JANITOR_MAX_CANDIDATES, default 200
    maxClusters: number;             // JANITOR_MAX_CLUSTERS, default 10
    maxClusterSize: number;          // JANITOR_MAX_CLUSTER_SIZE, default 6
    circuitBreakerLimit: number;     // consecutive provider errors before abort, default 3
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): JanitorConfig => ({
    dryRun: (env.JANITOR_DRY_RUN ?? 'true').toLowerCase() !== 'false',
    windowHours: Number(env.JANITOR_WINDOW_HOURS ?? 48),
    similarityThreshold: Number(env.JANITOR_SIMILARITY_THRESHOLD ?? 0.75),
    confidenceThreshold: Number(env.JANITOR_CONFIDENCE_THRESHOLD ?? 0.8),
    maxCandidates: Number(env.JANITOR_MAX_CANDIDATES ?? 200),
    maxClusters: Number(env.JANITOR_MAX_CLUSTERS ?? 10),
    maxClusterSize: Number(env.JANITOR_MAX_CLUSTER_SIZE ?? 6),
    circuitBreakerLimit: Number(env.JANITOR_CIRCUIT_BREAKER ?? 3)
});

/** Tags applied by the janitor. Candidates carrying any of these are excluded
 *  from future cycles (loop prevention + idempotency). */
export const JANITOR_TAGS = {
    META_TRUTH: 'META_TRUTH',
    SUPERSEDED: 'SUPERSEDED',
    SUPERSEDED_BY_PREFIX: 'SUPERSEDED_BY:',
    SYNTHESIZED: 'SYNTHESIZED',
    JANITOR: 'janitor',
    TRUTH_REVISION: 'truth_revision'
} as const;

// ---------------------------------------------------------------------------
// Dependency ports (production wiring at the bottom; tests inject fakes)
// ---------------------------------------------------------------------------

export interface LlmJudge {
    /** Ask one provider to classify/verify a cluster. Returns raw text (JSON expected). */
    judge(prompt: string): Promise<{ text: string; provider: string; model: string }>;
}

export interface JanitorDeps {
    /** Candidate memory nodes for the window (already tier-filtered upstream). */
    getCandidates(windowHours: number, maxCandidates: number): Promise<MemoryNode[]>;
    /** Embedding for clustering (production: gemini-embedding-001 @768). */
    embed(text: string): Promise<number[] | null>;
    /** Upsert a node (production: lancedbService.store — mergeInsert by id). */
    upsertNode(node: MemoryNode): Promise<void>;
    /** Fetch a node by id (for unsupersede). */
    getNodeById(id: string): Promise<MemoryNode | null>;
    /** Optional second-copy archive for originals (cold archive, roadmap item 7).
     *  Called with the ORIGINAL node before marking; failures never break a run. */
    archiveOriginal?(node: MemoryNode, reason: string): Promise<void>;
    /** Detector: provider A (production: Groq gpt-oss-120b). */
    detector: LlmJudge;
    /** Verifier: provider B, MUST be a different provider (production: OpenRouter nemotron free). */
    verifier: LlmJudge;
    ledger: RevisionLedger;
    /** Records a human/narrator-visible note that a truth changed (production:
     *  stores an INTROSPECTION-tagged memory so the narrator's evidence
     *  stream picks it up). */
    noteRevision(text: string, refs: string[]): Promise<void>;
    now(): number;
    newId(): string;
}

export interface ClusterVerdict {
    action: JanitorAction;
    memberIds: string[];
    confidence: number;
    metaTruth?: string;
    reason: string;
}

export interface JanitorRunReport {
    runId: string;
    dryRun: boolean;
    candidates: number;
    clusters: number;
    applied: number;
    proposed: number;
    abstained: number;
    errors: number;
    abortedByCircuitBreaker: boolean;
    durationMs: number;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function detectorPrompt(members: MemoryNode[]): string {
    const facts = members.map(m => `- [ID:${m.id}] (ts:${new Date(m.timestamp).toISOString()}) ${m.content}`).join('\n');
    return `You are the Truth Evaluation Engine of an autonomous agent's memory.
Analyze these memory entries and classify the situation with EXACTLY ONE action:
- EXP: entries are unrelated or complementary; nothing to resolve.
- DUP: entries restate the same belief; no contradiction.
- REV: a belief was REVISED (contradiction OR legitimate change over time — e.g. "liked coffee in March" vs "hates coffee in October" is a revision, NOT an error; both stay in history).
- CON: a belief was RETRACTED/withdrawn by its source.

Rules:
- A preference that changed over time is REV with the newer entry as the current truth. Both entries remain in the chain; nothing is lost.
- When uncertain, choose EXP or DUP (never act on a guess).

Respond with ONLY a JSON object (no markdown):
{"action":"EXP|DUP|REV|CON","confidence":0.0-1.0,"metaTruth":"the single current truth (required for REV/CON, first person neutral)","reason":"short explanation"}

ENTRIES:
${facts}`;
}

function verifierPrompt(members: MemoryNode[], verdict: ClusterVerdict): string {
    const facts = members.map(m => `- [ID:${m.id}] (ts:${new Date(m.timestamp).toISOString()}) ${m.content}`).join('\n');
    return `You are an INDEPENDENT VERIFIER for a memory truth-resolution system. Another model proposed the action below. Judge ONLY whether the proposal is justified by the entries.

PROPOSED: action=${verdict.action}, confidence=${verdict.confidence}, metaTruth="${verdict.metaTruth ?? ''}", reason="${verdict.reason}"

Rules:
- agree=true ONLY if the proposal is clearly justified. A preference changing over time justifies REV (not CON).
- If you have ANY doubt, agree=false (abstention is the safe default).

Respond with ONLY a JSON object: {"agree":true|false,"reason":"short explanation"}

ENTRIES:
${facts}`;
}

// ---------------------------------------------------------------------------
// Clustering (cosine similarity over embeddings, union-find)
// ---------------------------------------------------------------------------

function cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function clusterBySimilarity(nodes: MemoryNode[], vectors: (number[] | null)[], threshold: number, maxClusterSize: number): MemoryNode[][] {
    const parent = nodes.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < nodes.length; i++) {
        if (!vectors[i]) continue;
        for (let j = i + 1; j < nodes.length; j++) {
            if (!vectors[j]) continue;
            if (cosine(vectors[i]!, vectors[j]!) >= threshold) {
                const ri = find(i), rj = find(j);
                if (ri !== rj) parent[ri] = rj;
            }
        }
    }
    const groups = new Map<number, MemoryNode[]>();
    nodes.forEach((n, i) => {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r)!.push(n);
    });
    return [...groups.values()]
        .filter(g => g.length >= 2)
        .map(g => g.slice(0, maxClusterSize));
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export class JanitorService {
    constructor(private readonly deps: JanitorDeps, private readonly config: JanitorConfig = loadConfig()) {}

    async runCycle(): Promise<JanitorRunReport> {
        const started = this.deps.now();
        const runId = this.deps.newId();
        const report: JanitorRunReport = {
            runId, dryRun: this.config.dryRun, candidates: 0, clusters: 0,
            applied: 0, proposed: 0, abstained: 0, errors: 0,
            abortedByCircuitBreaker: false, durationMs: 0
        };
        let consecutiveErrors = 0;

        // Stage 1 — candidate selection (eternal-memory safe: read-only)
        const all = await this.deps.getCandidates(this.config.windowHours, this.config.maxCandidates);
        const candidates = all.filter(n => !this.isProcessed(n));
        report.candidates = candidates.length;
        if (candidates.length < 2) { report.durationMs = this.deps.now() - started; return report; }

        // Stage 1b — embedding clustering (cost guard: only similar pairs reach the LLM)
        const vectors: (number[] | null)[] = [];
        for (const n of candidates) {
            try { vectors.push(await this.deps.embed(n.content)); }
            catch { vectors.push(null); }
        }
        const clusters = clusterBySimilarity(candidates, vectors, this.config.similarityThreshold, this.config.maxClusterSize)
            .slice(0, this.config.maxClusters);
        report.clusters = clusters.length;

        // Stages 2-5 — detect, verify, resolve, audit
        for (const cluster of clusters) {
            if (consecutiveErrors >= this.config.circuitBreakerLimit) {
                report.abortedByCircuitBreaker = true;
                this.log({ ts: this.deps.now(), runId, event: 'ERROR', clusterIds: [], dryRun: this.config.dryRun, reason: `Circuit breaker: ${consecutiveErrors} consecutive provider errors, run aborted` });
                report.errors++;
                break;
            }
            try {
                const outcome = await this.processCluster(cluster, runId);
                consecutiveErrors = 0;
                if (outcome === 'applied') report.applied++;
                else if (outcome === 'proposed') report.proposed++;
                else if (outcome === 'abstained') report.abstained++;
            } catch (e: any) {
                consecutiveErrors++;
                report.errors++;
                this.log({ ts: this.deps.now(), runId, event: 'ERROR', clusterIds: cluster.map(m => m.id), dryRun: this.config.dryRun, reason: `Cluster failed safely (nothing modified): ${e?.message || e}` });
            }
        }

        report.durationMs = this.deps.now() - started;
        return report;
    }

    private async processCluster(cluster: MemoryNode[], runId: string): Promise<'applied' | 'proposed' | 'abstained' | 'noop'> {
        // Stage 2 — detection (provider A)
        const det = await this.deps.detector.judge(detectorPrompt(cluster));
        const verdict = this.parseVerdict(det.text);
        if (!verdict) {
            this.log({ ts: this.deps.now(), runId, event: 'ABSTAINED', clusterIds: cluster.map(m => m.id), detector: { provider: det.provider, model: det.model }, dryRun: this.config.dryRun, reason: 'Detector returned unparseable verdict; abstained by default' });
            return 'abstained';
        }
        const memberIds = cluster.map(m => m.id);
        const detectorVerdict = { provider: det.provider, model: det.model, action: verdict.action, confidence: verdict.confidence, reason: verdict.reason };

        // EXP/DUP: no mutation ever needed — nothing to do, nothing to log at volume.
        if (verdict.action === 'EXP' || verdict.action === 'DUP') return 'noop';

        // Layer 1 — confidence gate (abstention is the default when uncertain)
        if (verdict.confidence < this.config.confidenceThreshold || !verdict.metaTruth?.trim()) {
            this.log({ ts: this.deps.now(), runId, event: 'ABSTAINED', action: verdict.action, clusterIds: memberIds, detector: detectorVerdict, dryRun: this.config.dryRun, reason: `Below confidence threshold (${verdict.confidence} < ${this.config.confidenceThreshold}) or missing meta-truth` });
            return 'abstained';
        }

        // Layer 2 — independent verification (N-version: a DIFFERENT provider must agree)
        const ver = await this.deps.verifier.judge(verifierPrompt(cluster, verdict));
        const verParsed = this.parseAgreement(ver.text);
        const verifierVerdict = { provider: ver.provider, model: ver.model, agrees: verParsed?.agrees, reason: verParsed?.reason ?? 'unparseable' };
        if (!verParsed?.agrees) {
            this.log({ ts: this.deps.now(), runId, event: 'ABSTAINED', action: verdict.action, clusterIds: memberIds, detector: detectorVerdict, verifier: verifierVerdict, dryRun: this.config.dryRun, reason: `Independent verifier did not agree: ${verifierVerdict.reason}` });
            return 'abstained';
        }

        // Layer 3 — dry-run: record the proposal, touch nothing
        if (this.config.dryRun) {
            this.log({ ts: this.deps.now(), runId, event: 'PROPOSED', action: verdict.action, clusterIds: memberIds, metaTruthContent: verdict.metaTruth, detector: detectorVerdict, verifier: verifierVerdict, dryRun: true, reason: `Dry-run proposal (verified by ${ver.provider}): ${verdict.reason}` });
            return 'proposed';
        }

        // Stage 3 — resolution: write meta-truth, mark members superseded. NEVER delete.
        const metaTruthId = this.deps.newId();
        const metaNode: MemoryNode = {
            id: metaTruthId,
            content: `[META-TRUTH] ${verdict.metaTruth}`,
            timestamp: this.deps.now(),
            tier: MemoryTier.MEDIUM,
            importance: 0.9,
            tags: [JANITOR_TAGS.META_TRUTH, JANITOR_TAGS.JANITOR, JANITOR_TAGS.TRUTH_REVISION, verdict.action],
            accessCount: 0,
            lastAccess: this.deps.now(),
            parentIds: memberIds,
            decayHealth: 100,
            compressionLevel: 0
        };
        await this.deps.upsertNode(metaNode);
        for (const member of cluster) {
            const marked: MemoryNode = {
                ...member,
                tags: [...member.tags.filter(t => !t.startsWith(JANITOR_TAGS.SUPERSEDED_BY_PREFIX) && t !== JANITOR_TAGS.SUPERSEDED),
                       JANITOR_TAGS.SUPERSEDED, `${JANITOR_TAGS.SUPERSEDED_BY_PREFIX}${metaTruthId}`]
            };
            await this.deps.upsertNode(marked); // same id => upsert; content untouched
            // Cold archive: second copy of the full ORIGINAL (eternal memory ×2).
            // Archive failure must never break a janitor run.
            if (this.deps.archiveOriginal) {
                try { await this.deps.archiveOriginal(member, `janitor:superseded-by:${metaTruthId}`); }
                catch (e) { console.error('[JANITOR] cold-archive copy failed (primary store intact):', e); }
            }
        }

        // Stage 6 — surface the truth change to the consciousness/evidence stream
        await this.deps.noteRevision(
            `Truth revision (${verdict.action}): "${verdict.metaTruth}" supersedes ${memberIds.length} entr${memberIds.length === 1 ? 'y' : 'ies'}. Reason: ${verdict.reason}`,
            memberIds
        );

        this.log({ ts: this.deps.now(), runId, event: 'APPLIED', action: verdict.action, clusterIds: memberIds, metaTruthId, metaTruthContent: verdict.metaTruth, detector: detectorVerdict, verifier: verifierVerdict, dryRun: false, reason: verdict.reason });
        return 'applied';
    }

    /** Layer 6 — full reversibility: roll back a superseded marking. */
    async unsupersede(nodeId: string, reason: string): Promise<boolean> {
        const node = await this.deps.getNodeById(nodeId);
        if (!node) return false;
        const cleaned: MemoryNode = {
            ...node,
            tags: node.tags.filter(t => t !== JANITOR_TAGS.SUPERSEDED && !t.startsWith(JANITOR_TAGS.SUPERSEDED_BY_PREFIX))
        };
        await this.deps.upsertNode(cleaned);
        this.log({ ts: this.deps.now(), runId: 'manual', event: 'REVERTED', clusterIds: [nodeId], dryRun: false, reason: reason || 'Manual unsupersede' });
        return true;
    }

    metrics(): JanitorMetrics { return this.deps.ledger.metrics(); }

    private isProcessed(n: MemoryNode): boolean {
        return n.tags.some(t =>
            t === JANITOR_TAGS.META_TRUTH || t === JANITOR_TAGS.SUPERSEDED ||
            t === JANITOR_TAGS.SYNTHESIZED || t.startsWith(JANITOR_TAGS.SUPERSEDED_BY_PREFIX));
    }

    private parseVerdict(raw: string): ClusterVerdict | null {
        try {
            const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
            const obj = JSON.parse(clean);
            const action = String(obj.action || '').toUpperCase();
            if (!['EXP', 'REV', 'DUP', 'CON'].includes(action)) return null;
            const confidence = Number(obj.confidence);
            if (!Number.isFinite(confidence)) return null;
            return { action: action as JanitorAction, memberIds: [], confidence, metaTruth: obj.metaTruth, reason: String(obj.reason || 'no reason given') };
        } catch { return null; }
    }

    private parseAgreement(raw: string): { agrees: boolean; reason: string } | null {
        try {
            const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
            const obj = JSON.parse(clean);
            return { agrees: obj.agree === true, reason: String(obj.reason || 'no reason given') };
        } catch { return null; }
    }

    private log(entry: RevisionLedgerEntry): void {
        try { this.deps.ledger.append(entry); }
        catch (e) { console.error('[JANITOR] Ledger append failed (non-fatal):', e); }
    }
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

let singleton: JanitorService | null = null;

export async function getJanitorService(): Promise<JanitorService> {
    if (singleton) return singleton;
    const [{ lancedbService }, { generateEmbedding }, { OpenAICompatibleClient }, { builtInProviders }] = await Promise.all([
        import('../lancedbService'),
        import('../geminiService'),
        import('../llm/openAICompatible'),
        import('../llm/providerRegistry')
    ]);
    const client = new OpenAICompatibleClient();
    const groq = builtInProviders.find(p => p.id === 'GROQ');
    const openrouter = builtInProviders.find(p => p.id === 'OPENROUTER');
    if (!groq || !openrouter) throw new Error('GROQ/OPENROUTER providers not registered');

    const makeJudge = (provider: typeof groq, label: string) => ({
        judge: async (prompt: string) => {
            const result = await client.complete(provider, [{ role: 'user', content: prompt }], { temperature: 0, maxTokens: 800, timeout: 60000 });
            return { text: result.text, provider: label, model: result.model };
        }
    });

    singleton = new JanitorService({
        getCandidates: async (windowHours, maxCandidates) => {
            const since = Date.now() - windowHours * 3600_000;
            const [medium, long] = await Promise.all([
                lancedbService.getNodesByTier(MemoryTier.MEDIUM, 500),
                lancedbService.getNodesByTier(MemoryTier.LONG, 500)
            ]);
            return [...medium, ...long]
                .filter(n => n.timestamp >= since)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, maxCandidates);
        },
        embed: (text) => generateEmbedding(text),
        upsertNode: async (node) => { await lancedbService.store(node); },
        getNodeById: (id) => lancedbService.getNodeById(id),
        detector: makeJudge(groq, 'GROQ'),
        verifier: makeJudge(openrouter, 'OPENROUTER'),
        ledger: new RevisionLedger(defaultLedgerPath()),
        archiveOriginal: async (node, reason) => {
            const { getColdArchive } = await import('../memory/coldArchive');
            getColdArchive().append(node, reason);
        },
        noteRevision: async (text, refs) => {
            const { continuum } = await import('../continuumMemory');
            const { MemoryTier: MT } = await import('../../types');
            await continuum.store(
                `TRUTH REVISION [janitor]: ${text}`,
                MT.WORKING,
                [JANITOR_TAGS.JANITOR, JANITOR_TAGS.TRUTH_REVISION, 'consciousness', ...refs.slice(0, 4)],
                true
            );
        },
        now: () => Date.now(),
        newId: () => crypto.randomUUID()
    });
    return singleton;
}
