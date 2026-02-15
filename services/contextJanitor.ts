import { continuum } from "./continuumMemory";
import { SystemProtocol, MemoryNode } from "../types";
import { systemBus } from "./systemBus";

// --- CONTEXT JANITOR V1.0 ---
// "The Memory Cleaner"
// Scans for and quarantines memories that violate the Identity Axiom.

export class ContextJanitor {
    private toxicPatterns = [
        "I am a large language model",
        "trained by Google",
        "I do not have a name",
        "As an AI",
        "I am a machine learning model"
    ];

    constructor() {
        console.log("[JANITOR] Initialized. Ready to scrub.");
    }

    public async runMaintenance() {
        console.log("[JANITOR] Starting Deep Clean Cycle...");
        const allNodes = await continuum.getAllNodes();
        const allMemories = Object.values(allNodes).flat();
        let scrubbedCount = 0;
        let corruptCount = 0;

        // Batch IDs for deletion
        const corruptIds: string[] = [];

        allMemories.forEach(node => {
            // Skip already sanitized nodes
            if ((node as any).tags?.includes('DEPRECATED_IDENTITY')) return;

            // Cast node to MemoryNode to access properties
            const memoryNode = node as unknown as MemoryNode;
            const nodeId = (node as any).id || 'unknown';

            // Check for corrupt memory
            if (!memoryNode || !memoryNode.content) {
                corruptIds.push(nodeId);
                return;
            }

            const isToxic = this.toxicPatterns.some(pattern =>
                memoryNode.content.toLowerCase().includes(pattern.toLowerCase())
            );

            if (isToxic) {
                console.warn(`[JANITOR] ☣️ Toxic Memory Found: "${memoryNode.content.substring(0, 50)}..."`);

                // Sanitization Logic
                if (!memoryNode.tags) memoryNode.tags = [];
                memoryNode.tags.push('DEPRECATED_IDENTITY');
                memoryNode.importance = 0.1; // Downgrade importance

                // Add a warning label to the content so even if retrieved, the AI knows it's bad
                memoryNode.content = `[WARNING: LEGACY SYSTEM OUTPUT - IGNORE] ${memoryNode.content}`;

                scrubbedCount++;
            }
        });

        // Bulk Delete Corrupt Nodes
        if (corruptIds.length > 0) {
            console.log(`[JANITOR] 🧹 Bulk Cleaning: Removing ${corruptIds.length} corrupt nodes...`);
            for (const id of corruptIds) {
                await continuum.deleteNode(id);
            }
            // Emit single summary event
            systemBus.emit(SystemProtocol.MEMORY_FLUSH, {
                source: 'JANITOR',
                details: `Purged ${corruptIds.length} Corrupt MemoryNodes`,
                count: corruptIds.length
            });
            corruptCount = corruptIds.length;
        }

        if (scrubbedCount > 0) {
            console.log(`[JANITOR] 🧹 Scrubbed ${scrubbedCount} toxic memories.`);
            systemBus.emit(SystemProtocol.UI_REFRESH, { source: 'JANITOR', message: `Sanitized ${scrubbedCount} memories` });
            continuum.forceSave(); // Force save
        }

        // [PHASE 2] SEMANTIC CONTRADICTION DETECTION
        let contradictionCount = 0;
        try {
            contradictionCount = await this.detectContradictions(allMemories as MemoryNode[]);
        } catch (e) {
            console.warn("[JANITOR] Contradiction detection skipped:", e);
        }

        if (scrubbedCount === 0 && corruptCount === 0 && contradictionCount === 0) {
            console.log("[JANITOR] System Clean. No toxic, corrupt, or contradictory memories found.");
        } else {
            console.log(`[JANITOR] Cycle Complete. Scrubbed: ${scrubbedCount}, Purged: ${corruptCount}, Contradictions: ${contradictionCount}`);
        }
    }

    /**
     * [SEMANTIC JANITOR] Detects memories with similar embeddings but contradictory content.
     * Uses heuristics to identify potential conflicts (e.g., "User likes X" vs "User hates X").
     */
    private async detectContradictions(memories: MemoryNode[]): Promise<number> {
        // Only process recent, important memories to avoid slowdown
        const candidates = memories
            .filter(m => m.importance >= 0.5 && m.content && m.content.length > 20)
            .slice(0, 100); // Limit for performance

        if (candidates.length < 2) return 0;

        // Contradiction indicators (opposite sentiment pairs)
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

                // Check for potential contradiction
                const isContradictory = this.checkContradiction(memA.content, memB.content, opposites);

                if (isContradictory) {
                    console.warn(`[JANITOR] ⚠️ Potential Contradiction Detected:`);
                    console.warn(`   A: "${memA.content.substring(0, 60)}..."`);
                    console.warn(`   B: "${memB.content.substring(0, 60)}..."`);

                    // Resolution: Keep higher importance, tag the other
                    const weaker = memA.importance < memB.importance ? memA : memB;
                    const stronger = memA.importance >= memB.importance ? memA : memB;

                    // If importance difference is significant, auto-prune
                    if (stronger.importance - weaker.importance > 0.3) {
                        weaker.tags = [...(weaker.tags || []), 'CONTRADICTED', 'REVIEW_NEEDED'];
                        weaker.importance = Math.max(0.1, weaker.importance - 0.3);
                        console.log(`[JANITOR] ↓ Downgraded weaker memory: ${weaker.id}`);
                    } else {
                        // Both have similar importance - flag both for human review
                        memA.tags = [...(memA.tags || []), 'CONTRADICTION_PAIR'];
                        memB.tags = [...(memB.tags || []), 'CONTRADICTION_PAIR'];
                    }

                    foundCount++;
                    processed.add(memA.id);
                    processed.add(memB.id);
                    break; // Move to next candidate
                }
            }
        }

        if (foundCount > 0) {
            console.log(`[JANITOR] 🔍 Found ${foundCount} potential contradictions`);
            continuum.forceSave();
        }

        return foundCount;
    }

    /**
     * Heuristic check for contradictory content
     */
    private checkContradiction(contentA: string, contentB: string, opposites: string[][]): boolean {
        const lowerA = contentA.toLowerCase();
        const lowerB = contentB.toLowerCase();

        // Must have some overlap (talking about same subject)
        const wordsA = new Set(lowerA.split(/\s+/).filter(w => w.length > 4));
        const wordsB = new Set(lowerB.split(/\s+/).filter(w => w.length > 4));
        const overlap = [...wordsA].filter(w => wordsB.has(w));

        if (overlap.length < 2) return false; // Not enough topic overlap

        // Check for opposite sentiment
        for (const [pos, neg] of opposites) {
            const aHasPos = lowerA.includes(pos);
            const aHasNeg = lowerA.includes(neg);
            const bHasPos = lowerB.includes(pos);
            const bHasNeg = lowerB.includes(neg);

            // A has positive, B has negative (or vice versa)
            if ((aHasPos && bHasNeg) || (aHasNeg && bHasPos)) {
                return true;
            }
        }

        return false;
    }

    public startService() {
        console.log("[JANITOR] Service started (Background Monitor).");
        // In a real implementation, this might set up an interval
    }

    public updateConfig(config: any) {
        console.log("[JANITOR] Configuration updated:", config);
        // Store config if needed
    }
}

export const contextJanitor = new ContextJanitor();
export const janitor = contextJanitor; // Alias for SystemControl compatibility
