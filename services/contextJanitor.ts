import { continuum } from "./continuumMemory";
import { SystemProtocol, MemoryNode } from "../types";
import { systemBus } from "./systemBus";

// --- CONTEXT JANITOR V3.0 ---
// "The Memory Cleaner"
// Scans for and quarantines memories that violate the Identity Axiom.
// V3: Never destroys data. Contradictions are actively analyzed by LLM
// and resolved through experience, feedback, and full cognitive pipeline.

export interface QuarantineEntry {
    persistence?: 'saved-working' | 'outside-working';
    timestamp: number;
    nodeId: string;
    reason: 'CORRUPT_DATA' | 'TOXIC_IDENTITY' | 'CONTRADICTED';
    originalContent?: string;
    preservedImportance: number;
}

export interface ContradictionAuditEntry {
    timestamp: number;
    memoryA: { id: string; content: string; importance: number };
    memoryB: { id: string; content: string; importance: number };
    resolution: 'FLAGGED_FOR_REVIEW' | 'LLM_ANALYZING' | 'RESOLVED' | 'NEEDS_MORE_DATA';
    overlapWords: string[];
    contradictionType: string;
    // Snapshot commit and later experience storage are distinct outcomes.
    memoryEditStatus?: 'saved-working';
    experienceRecord?: { status: 'pending' | 'confirmed' | 'unverified'; error?: 'EXPERIENCE_RECORD_UNVERIFIED' };
    workingEditsSaved?: string[];
    persistentEditsUnresolved?: string[];
    llmVerdict?: string;       // LLM's analysis result
    resolvedBy?: string;       // 'LLM' | 'EXPERIENCE' | 'FEEDBACK' | 'HUMAN'
    resolvedAt?: number;       // Timestamp of resolution
    winnerMemoryId?: string;   // Which memory was determined to be more accurate
}

export class ContextJanitor {
    private toxicPatterns = [
        "I am a large language model",
        "trained by Google",
        "I do not have a name",
        "As an AI",
        "I am a machine learning model"
    ];

    // --- AUDIT TRAIL ---
    private quarantineLog: QuarantineEntry[] = [];
    private contradictionAuditLog: ContradictionAuditEntry[] = [];

    // --- RESOLUTION QUEUE ---
    private resolutionQueue: ContradictionAuditEntry[] = [];
    private isResolving = false;

    constructor() {
        console.log("[JANITOR] Initialized V3. Contradiction Resolution Active.");
    }

    // --- PUBLIC ACCESSORS ---

    public getQuarantineLog(): QuarantineEntry[] {
        return [...this.quarantineLog];
    }

    public getContradictionAuditLog(): ContradictionAuditEntry[] {
        return [...this.contradictionAuditLog];
    }

    /** Detached reads are preparation only. The Continuum owner compares
     * touched fields, admits the operation and awaits its durable RAM commit.
     * Persistent tiers were never saved by forceSave; report them explicitly
     * instead of silently claiming a DB correction from a borrowed object.
     */
    private async persistWorkingEdits(before: MemoryNode[], after: MemoryNode[], requireAll = false): Promise<{updated: string[]; outsideWorking: string[]}> {
        const prior = new Map(before.map(node => [node.id, node]));
        const fields = (node: MemoryNode) => ({content: node.content, originalContent: node.originalContent, tags: node.tags, importance: node.importance});
        const edits = after.flatMap(node => {
            const old = prior.get(node.id);
            if (!old) throw new Error('JANITOR_EDIT_BASELINE_MISSING');
            const beforeFields = fields(old), afterFields = fields(node);
            return JSON.stringify(beforeFields) === JSON.stringify(afterFields) ? [] : [{id: node.id, before: beforeFields, after: afterFields}];
        });
        const receipt = await continuum.applyWorkingEdits(edits, requireAll);
        if (receipt.outsideWorking.length) {
            // A detached unsupported edit is not a new state. Restore those
            // fields in the caller's draft before any later scan/audit uses it.
            const outside = new Set(receipt.outsideWorking);
            for (const node of after) if (outside.has(node.id)) {
                const old = prior.get(node.id)!;
                node.content = old.content;
                node.originalContent = old.originalContent;
                node.tags = structuredClone(old.tags);
                node.importance = old.importance;
            }
            console.warn('[JANITOR] Persistent-tier correction not saved by WORKING owner:', receipt.outsideWorking);
            if (requireAll) throw new Error('JANITOR_PERSISTENT_TIER_EDITS_UNRESOLVED');
        }
        return receipt;
    }

    // --- QUARANTINE (NEVER DELETE) ---

    /**
     * Quarantines a memory node instead of deleting it.
     * The node is tagged, importance reduced to near-zero,
     * and originalContent is preserved for audit/recovery.
     */
    private async quarantineNode(nodeId: string, reason: QuarantineEntry['reason'], node?: MemoryNode): Promise<boolean> {
        const entry: QuarantineEntry = {
            timestamp: Date.now(),
            nodeId,
            reason,
            originalContent: node?.content?.substring(0, 200),
            preservedImportance: node?.importance ?? 0
        };
        const before = node ? structuredClone(node) : undefined;

        // If we have the node reference, tag it in-place instead of deleting
        if (node) {
            if (!node.originalContent) {
                node.originalContent = node.content;
            }
            node.tags = [...(node.tags || []), 'QUARANTINED', `QUARANTINE_${reason}`];
            node.importance = 0.01;
            node.content = `[QUARANTINED: ${reason}] ${node.content}`;
        }

        const receipt = node && before ? await this.persistWorkingEdits([before], [node]) : {updated: [], outsideWorking: [nodeId]};
        this.quarantineLog.push({...entry, persistence: receipt.updated.includes(nodeId) ? 'saved-working' : 'outside-working'});
        if (!receipt.updated.includes(nodeId)) return false;
        // Emit only after the owner confirms the correction was saved.
        systemBus.emit(SystemProtocol.MEMORY_QUARANTINE, {
            source: 'JANITOR',
            nodeId,
            reason,
            details: `Node quarantined: ${reason}`
        });
        return true;
    }

    public async runMaintenance() {
        console.log("[JANITOR] Starting Deep Clean Cycle...");
        const allNodes = await continuum.getAllNodes();
        const allMemories = Object.values(allNodes).flat();
        const beforeScrub = structuredClone(allMemories);
        const scrubbedIds = new Set<string>();
        let scrubbedCount = 0;
        let quarantineCount = 0;

        // Collect nodes for quarantine (instead of deletion)
        const corruptNodes: { id: string; node: MemoryNode | undefined }[] = [];

        allMemories.forEach(node => {
            // Skip already sanitized or quarantined nodes
            if ((node as any).tags?.includes('DEPRECATED_IDENTITY')) return;
            if ((node as any).tags?.includes('QUARANTINED')) return;

            const memoryNode = node as unknown as MemoryNode;
            const nodeId = (node as any).id || 'unknown';

            // Check for corrupt memory
            if (!memoryNode || !memoryNode.content) {
                corruptNodes.push({ id: nodeId, node: memoryNode });
                return;
            }

            const isToxic = this.toxicPatterns.some(pattern =>
                memoryNode.content.toLowerCase().includes(pattern.toLowerCase())
            );

            if (isToxic) {
                console.warn(`[JANITOR] ☣️ Toxic Memory Found: "${memoryNode.content.substring(0, 50)}..."`);

                if (!memoryNode.originalContent) {
                    memoryNode.originalContent = memoryNode.content;
                }
                if (!memoryNode.tags) memoryNode.tags = [];
                memoryNode.tags.push('DEPRECATED_IDENTITY');
                memoryNode.importance = 0.1;

                memoryNode.content = `[WARNING: LEGACY SYSTEM OUTPUT - IGNORE] ${memoryNode.content}`;
                scrubbedIds.add(memoryNode.id);
            }
        });

        const scrubReceipt = await this.persistWorkingEdits(
            beforeScrub.filter(n => scrubbedIds.has(n.id)),
            allMemories.filter(n => scrubbedIds.has(n.id))
        );
        scrubbedCount = scrubReceipt.updated.length;

        // Quarantine Corrupt Nodes (never destroy)
        if (corruptNodes.length > 0) {
            console.log(`[JANITOR] 🔒 Quarantining ${corruptNodes.length} corrupt nodes (preserved for audit)...`);
            for (const { id, node } of corruptNodes) {
                if (await this.quarantineNode(id, 'CORRUPT_DATA', node)) quarantineCount++;
            }
            if (quarantineCount > 0) systemBus.emit(SystemProtocol.MEMORY_FLUSH, {
                source: 'JANITOR',
                details: `Quarantined ${quarantineCount} Corrupt MemoryNodes (preserved)`,
                count: quarantineCount
            });
        }

        if (scrubbedCount > 0) {
            console.log(`[JANITOR] 🧹 Scrubbed ${scrubbedCount} toxic memories.`);
            systemBus.emit(SystemProtocol.UI_REFRESH, { source: 'JANITOR', message: `Sanitized ${scrubbedCount} memories` });
        }

        // [PHASE 2] SEMANTIC CONTRADICTION DETECTION + LLM RESOLUTION
        let contradictionCount = 0;
        try {
            contradictionCount = await this.detectContradictions(allMemories as MemoryNode[]);
        } catch (e) {
            console.warn("[JANITOR] Contradiction detection skipped:", e);
        }

        // [PHASE 3] PROCESS RESOLUTION QUEUE (LLM-powered)
        if (this.resolutionQueue.length > 0 && !this.isResolving) {
            // Fire-and-forget resolution — runs asynchronously, doesn't block maintenance
            this.processResolutionQueue().catch(e =>
                console.warn("[JANITOR] Resolution queue processing failed:", e)
            );
        }

        if (scrubbedCount === 0 && quarantineCount === 0 && contradictionCount === 0) {
            console.log("[JANITOR] System Clean. No toxic, corrupt, or contradictory memories found.");
        } else {
            console.log(`[JANITOR] Cycle Complete. Scrubbed: ${scrubbedCount}, Quarantined: ${quarantineCount}, Contradictions: ${contradictionCount}`);
        }
    }

    /**
     * [SEMANTIC JANITOR] Detects contradictory memories using heuristics.
     * Detected contradictions are queued for LLM analysis — never auto-deleted.
     * Both memories are preserved until the resolution pipeline determines truth.
     */
    private async detectContradictions(memories: MemoryNode[]): Promise<number> {
        const candidates = memories
            .filter(m => m.importance >= 0.5 && m.content && m.content.length > 20)
            .filter(m => !m.tags?.includes('QUARANTINED'))
            .filter(m => !m.tags?.includes('CONTRADICTION_RESOLVED'))
            .slice(0, 100);

        if (candidates.length < 2) return 0;

        const opposites = [
            ['like', 'dislike'], ['love', 'hate'], ['prefer', 'avoid'],
            ['yes', 'no'], ['true', 'false'], ['is', 'is not'],
            ['can', 'cannot'], ['will', 'will not'], ['always', 'never']
        ];

        let foundCount = 0;
        const processed = new Set<string>();

        for (let i = 0; i < candidates.length; i++) {
            const memA = candidates[i];
            if (processed.has(memA.id)) continue;

            for (let j = i + 1; j < candidates.length; j++) {
                const memB = candidates[j];
                if (processed.has(memB.id)) continue;

                const contradictionInfo = this.checkContradiction(memA.content, memB.content, opposites);

                if (contradictionInfo) {
                    console.warn(`[JANITOR] ⚠️ Potential Contradiction Detected:`);
                    console.warn(`   A: "${memA.content.substring(0, 60)}..."`);
                    console.warn(`   B: "${memB.content.substring(0, 60)}..."`);

                    const beforePair = structuredClone([memA, memB]);
                    // Tag both as contradiction pair for review (PRESERVED, importance floor 0.3)
                    memA.tags = [...(memA.tags || []), 'CONTRADICTION_PAIR'];
                    memB.tags = [...(memB.tags || []), 'CONTRADICTION_PAIR'];
                    memA.importance = Math.max(0.3, memA.importance);
                    memB.importance = Math.max(0.3, memB.importance);

                    const pairReceipt = await this.persistWorkingEdits(beforePair, [memA, memB]);
                    // The audit is a review queue, not a persistence receipt.
                    // Persisted WORKING IDs and unsupported owner IDs are explicit.
                    // Create audit entry and queue for LLM resolution
                    const auditEntry: ContradictionAuditEntry = {
                        timestamp: Date.now(),
                        memoryA: { id: memA.id, content: memA.content.substring(0, 200), importance: memA.importance },
                        memoryB: { id: memB.id, content: memB.content.substring(0, 200), importance: memB.importance },
                        resolution: 'FLAGGED_FOR_REVIEW',
                        workingEditsSaved: pairReceipt.updated,
                        persistentEditsUnresolved: pairReceipt.outsideWorking,
                        overlapWords: contradictionInfo.overlapWords,
                        contradictionType: contradictionInfo.type
                    };
                    this.contradictionAuditLog.push(auditEntry);
                    this.resolutionQueue.push(auditEntry); // Queue for LLM analysis

                    systemBus.emit(SystemProtocol.CONTRADICTION_DETECTED, {
                        source: 'JANITOR',
                        memoryA: memA.id,
                        memoryB: memB.id,
                        type: contradictionInfo.type,
                        details: `Contradiction queued for LLM resolution: "${memA.content.substring(0, 40)}" vs "${memB.content.substring(0, 40)}"`
                    });

                    foundCount++;
                    processed.add(memA.id);
                    processed.add(memB.id);
                    break;
                }
            }
        }

        if (foundCount > 0) {
            console.log(`[JANITOR] 🔍 Found ${foundCount} contradictions (queued for LLM resolution)`);
        }

        return foundCount;
    }

    /**
     * [LLM RESOLUTION PIPELINE]
     * Processes contradiction queue asynchronously using the best available LLM.
     * Leverages:
     * - generateText (primary LLM) for deep analysis
     * - experienceBuffer for past context and lessons learned
     * - continuum memory for related historical data
     * - All existing feedback/learning mechanisms
     * 
     * The LLM determines which memory is more likely true, or if both could
     * coexist under different contexts. Resolution is recorded as an EXPERIENCE
     * so the system learns from contradiction patterns over time.
     */
    private async processResolutionQueue(): Promise<void> {
        if (this.isResolving || this.resolutionQueue.length === 0) return;
        this.isResolving = true;

        console.log(`[JANITOR] 🧠 Starting LLM contradiction resolution (${this.resolutionQueue.length} pending)...`);

        try {
            // Dynamic imports to avoid circular dependencies
            const { generateText } = await import('./geminiService');
            const { experienceBuffer } = await import('./experienceBuffer');

            // Process up to 3 contradictions per cycle (rate limit friendly)
            const batch = this.resolutionQueue.splice(0, 3);

            for (const entry of batch) {
                // A saved relative transformation is terminal for this queue.
                // Even an accidental duplicate must not call providers or edit
                // again merely because its later experience is unverified.
                if (entry.memoryEditStatus === 'saved-working') continue;
                try {
                    entry.resolution = 'LLM_ANALYZING';

                    // 1. Gather context: search for related experiences & memories
                    const contextQuery = `${entry.memoryA.content} ${entry.memoryB.content}`;
                    const relatedExperiences = await experienceBuffer.getRelevant(contextQuery, 5);
                    const relatedMemories = await continuum.retrieve(contextQuery, undefined, undefined);

                    const experienceContext = relatedExperiences.length > 0
                        ? relatedExperiences.map(e => `[${e.type}] ${e.context}: ${e.outcome}`).join('\n')
                        : 'No prior experiences found.';

                    const memoryContext = relatedMemories.slice(0, 5)
                        .map(m => m.content.substring(0, 100))
                        .join('\n');

                    // 2. Ask LLM to resolve with full context
                    const prompt = `You are the MEMORY INTEGRITY ANALYZER for Silhouette Agency OS.
Two memories in the system contradict each other. Your job is to determine which is more likely accurate using all available context.

MEMORY A (importance: ${entry.memoryA.importance.toFixed(2)}):
"${entry.memoryA.content}"

MEMORY B (importance: ${entry.memoryB.importance.toFixed(2)}):
"${entry.memoryB.content}"

CONTRADICTION TYPE: ${entry.contradictionType}
OVERLAP KEYWORDS: ${entry.overlapWords.join(', ')}

RELATED EXPERIENCES FROM SYSTEM HISTORY:
${experienceContext}

RELATED MEMORIES:
${memoryContext}

ANALYSIS RULES:
1. If one memory has more supporting evidence from experiences/history, it's more likely true.
2. If both could be true in different CONTEXTS (e.g., user changed preference over time), mark as "BOTH_VALID_TEMPORAL" — the newer one takes precedence but the older one is kept as historical.
3. If there's not enough data to determine truth, mark as "NEEDS_MORE_DATA" — the system will revisit this through its curiosity/introspection engines.
4. NEVER destroy information. Only adjust relative importance.

Respond in JSON:
{
  "verdict": "A_WINS" | "B_WINS" | "BOTH_VALID_TEMPORAL" | "NEEDS_MORE_DATA",
  "reasoning": "Brief explanation...",
  "confidence": 0.0 to 1.0,
  "suggestedAction": "What the system should do next"
}`;

                    const response = await generateText(prompt, { model: 'gemini-2.0-flash' });

                    // 3. Parse LLM response
                    let verdict: any = { verdict: 'NEEDS_MORE_DATA', reasoning: 'Parsing failed', confidence: 0.3 };
                    try {
                        const jsonMatch = response.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            verdict = JSON.parse(jsonMatch[0]);
                        }
                    } catch {
                        verdict = { verdict: 'NEEDS_MORE_DATA', reasoning: response.substring(0, 200), confidence: 0.3 };
                    }

                    // 4. Apply resolution based on verdict
                    entry.llmVerdict = JSON.stringify(verdict);
                    entry.resolvedBy = 'LLM';
                    entry.resolvedAt = Date.now();

                    if (verdict.verdict === 'A_WINS' && verdict.confidence >= 0.7) {
                        // Boost winner, reduce (but keep) loser
                        await this.applyVerdictToMemories(entry.memoryA.id, entry.memoryB.id, verdict);
                        entry.memoryEditStatus = 'saved-working';
                        entry.resolution = 'RESOLVED';
                        entry.winnerMemoryId = entry.memoryA.id;
                        console.log(`[JANITOR] ✅ Resolved: Memory A wins (${verdict.reasoning?.substring(0, 50)}...)`);

                    } else if (verdict.verdict === 'B_WINS' && verdict.confidence >= 0.7) {
                        await this.applyVerdictToMemories(entry.memoryB.id, entry.memoryA.id, verdict);
                        entry.memoryEditStatus = 'saved-working';
                        entry.resolution = 'RESOLVED';
                        entry.winnerMemoryId = entry.memoryB.id;
                        console.log(`[JANITOR] ✅ Resolved: Memory B wins (${verdict.reasoning?.substring(0, 50)}...)`);

                    } else if (verdict.verdict === 'BOTH_VALID_TEMPORAL') {
                        // Both keep importance, tagged as temporal evolution
                        await this.tagTemporalEvolution(entry.memoryA.id, entry.memoryB.id);
                        entry.memoryEditStatus = 'saved-working';
                        entry.resolution = 'RESOLVED';
                        console.log(`[JANITOR] 📅 Both valid (temporal): memories represent preference evolution`);

                    } else {
                        // NEEDS_MORE_DATA — leave flagged for curiosity/introspection engines
                        entry.resolution = 'NEEDS_MORE_DATA';
                        console.log(`[JANITOR] 🔍 Needs more data: queued for curiosity/introspection engines`);

                        // Emit epistemic gap so curiosity engine can investigate
                        systemBus.emit(SystemProtocol.EPISTEMIC_GAP_DETECTED, {
                            source: 'JANITOR',
                            type: 'CONTRADICTION_UNRESOLVED',
                            details: `Contradiction needs investigation: "${entry.memoryA.content.substring(0, 40)}" vs "${entry.memoryB.content.substring(0, 40)}"`,
                            memoryIds: [entry.memoryA.id, entry.memoryB.id]
                        });
                    }

                    // 5. Record as EXPERIENCE so the system learns from contradiction patterns
                    entry.experienceRecord = { status: 'pending' };
                    try {
                        await experienceBuffer.record({
                            type: verdict.verdict === 'NEEDS_MORE_DATA' ? 'LEARNING' : 'SUCCESS',
                            context: `Contradiction resolution: ${entry.contradictionType}`,
                            action: `LLM analysis of contradictory memories`,
                            outcome: `Verdict: ${verdict.verdict} (confidence: ${verdict.confidence}). ${verdict.reasoning?.substring(0, 100)}`,
                            lesson: verdict.suggestedAction || `Pattern: ${entry.contradictionType} contradictions can be ${verdict.verdict}`,
                            agentId: 'JANITOR'
                        });
                        entry.experienceRecord = { status: 'confirmed' };
                    } catch (error) {
                        // record() can fail after writing but before verified
                        // readback. Neither absent nor safe-to-retry is known.
                        entry.experienceRecord = { status: 'unverified', error: 'EXPERIENCE_RECORD_UNVERIFIED' };
                        console.warn('[JANITOR] Experience record unverified; preserving prior resolution without replay:', error);
                    }

                } catch (e) {
                    console.warn(`[JANITOR] Resolution failed for pair ${entry.memoryA.id} / ${entry.memoryB.id}:`, e);
                    // A later failure cannot revoke an acknowledged memory
                    // commit or requeue a non-idempotent transformation.
                    if (entry.memoryEditStatus === 'saved-working') continue;
                    entry.resolution = 'NEEDS_MORE_DATA';
                    entry.winnerMemoryId = undefined;
                    entry.resolvedAt = undefined;
                    entry.resolvedBy = undefined;
                    // Do not repeat a relative boost/prefix after a partial
                    // RAM commit whose disk save failed. Keep the unresolved
                    // audit for review; the persistence owner retains failure.
                    if (!(e instanceof Error && ['CONTINUUM_EDIT_COMMIT_FAILED', 'CONTINUUM_EDIT_OWNER_UNSUPPORTED'].includes(e.message))) this.resolutionQueue.push(entry);
                }
            }
        } catch (e) {
            console.error('[JANITOR] Resolution pipeline error:', e);
        } finally {
            this.isResolving = false;
        }
    }

    /**
     * Applies a verdict to memories: boosts winner's importance, reduces loser's (never below 0.2).
     * The loser is tagged CONTRADICTION_LOSER but NEVER deleted — serves as historical record.
     */
    private async applyVerdictToMemories(winnerId: string, loserId: string, verdict: any): Promise<void> {
        try {
            const allNodes = await continuum.getAllNodes();
            const allMemories = Object.values(allNodes).flat() as unknown as MemoryNode[];
            const before = structuredClone(allMemories);

            const winner = allMemories.find(m => m.id === winnerId);
            const loser = allMemories.find(m => m.id === loserId);

            if (!winner || !loser) throw new Error('JANITOR_VERDICT_MEMORY_MISSING');
            if (winner) {
                winner.importance = Math.min(1.0, winner.importance + 0.1); // Boost
                winner.tags = [...(winner.tags || []).filter(t => t !== 'CONTRADICTION_PAIR'), 'CONTRADICTION_RESOLVED', 'CONTRADICTION_WINNER'];
            }

            if (loser) {
                loser.importance = Math.max(0.2, loser.importance - 0.2); // Reduce but preserve
                loser.tags = [...(loser.tags || []).filter(t => t !== 'CONTRADICTION_PAIR'), 'CONTRADICTION_RESOLVED', 'CONTRADICTION_LOSER'];
                // Prepend context so the system knows this memory was disputed
                loser.content = `[DISPUTED - See winner: ${winnerId}] ${loser.content}`;
            }

            await this.persistWorkingEdits(before, allMemories, true);
        } catch (e) {
            console.warn('[JANITOR] Failed to apply verdict to memories:', e);
            throw e;
        }
    }

    /**
     * Tags both memories as temporal evolution — both are valid at different points in time.
     * The system treats the newer one as current truth but keeps the older for context.
     */
    private async tagTemporalEvolution(memIdA: string, memIdB: string): Promise<void> {
        try {
            const allNodes = await continuum.getAllNodes();
            const allMemories = Object.values(allNodes).flat() as unknown as MemoryNode[];
            const before = structuredClone(allMemories);

            const memA = allMemories.find(m => m.id === memIdA);
            const memB = allMemories.find(m => m.id === memIdB);

            if (!memA || !memB) throw new Error('JANITOR_TEMPORAL_MEMORY_MISSING');
            if (memA) {
                memA.tags = [...(memA.tags || []).filter(t => t !== 'CONTRADICTION_PAIR'), 'CONTRADICTION_RESOLVED', 'TEMPORAL_EVOLUTION'];
            }
            if (memB) {
                memB.tags = [...(memB.tags || []).filter(t => t !== 'CONTRADICTION_PAIR'), 'CONTRADICTION_RESOLVED', 'TEMPORAL_EVOLUTION'];
            }

            await this.persistWorkingEdits(before, allMemories, true);
        } catch (e) {
            console.warn('[JANITOR] Failed to tag temporal evolution:', e);
            throw e;
        }
    }

    /**
     * Heuristic check for contradictory content — returns details or null.
     */
    private checkContradiction(
        contentA: string,
        contentB: string,
        opposites: string[][]
    ): { type: string; overlapWords: string[] } | null {
        const lowerA = contentA.toLowerCase();
        const lowerB = contentB.toLowerCase();

        const wordsA = new Set(lowerA.split(/\s+/).filter(w => w.length > 4));
        const wordsB = new Set(lowerB.split(/\s+/).filter(w => w.length > 4));
        const overlap = [...wordsA].filter(w => wordsB.has(w));

        if (overlap.length < 2) return null;

        for (const [pos, neg] of opposites) {
            const aHasPos = lowerA.includes(pos);
            const aHasNeg = lowerA.includes(neg);
            const bHasPos = lowerB.includes(pos);
            const bHasNeg = lowerB.includes(neg);

            if ((aHasPos && bHasNeg) || (aHasNeg && bHasPos)) {
                return {
                    type: `${pos}/${neg}`,
                    overlapWords: overlap.slice(0, 5)
                };
            }
        }

        return null;
    }

    public startService() {
        console.log("[JANITOR] Service started (Background Monitor + LLM Resolution Pipeline).");
    }

    public updateConfig(config: any) {
        console.log("[JANITOR] Configuration updated:", config);
    }
}

export const contextJanitor = new ContextJanitor();
export const janitor = contextJanitor;
