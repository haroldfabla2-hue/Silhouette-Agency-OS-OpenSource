// ═══════════════════════════════════════════════════════════════════════════
// SILHOUETTE BRAIN ↔ OS MEMORY BRIDGE
// ───────────────────────────────────────────────────────────────────────────
// Glue layer that connects the external `silhouette-brain` 4-Tier memory system
// to the OS's cognitive loop. Two responsibilities:
//
//   1. READ  — turn the Brain's reasoning context into a compact text block that
//              the ContextAssembler can splice into the agent prompt.
//   2. WRITE — mirror locally-stored memories into the Brain (fire-and-forget)
//              so both systems converge over time.
//
// Everything here is best-effort: if the Brain is disabled or down, callers get
// empty results and the OS keeps working on its native memory alone.
// ═══════════════════════════════════════════════════════════════════════════

import { brainClient, BrainClient, BrainReasoningContext, BrainMemoryEntry } from './brainClient';
import { logger } from '../logger';

const log = logger.child({ service: 'BrainBridge' });

export interface BrainContextBlock {
    /** Human-readable block ready to inject into a prompt ('' when nothing). */
    text: string;
    /** Whether the Brain actually contributed anything. */
    hasContent: boolean;
    /** Structured semantic hits (for programmatic consumers). */
    semantic: BrainMemoryEntry[];
    /** Structured recent hits. */
    recent: BrainMemoryEntry[];
    /** Optional LLM synthesis from the Brain's reasoning engine. */
    synthesis?: string;
}

const EMPTY_BLOCK: BrainContextBlock = { text: '', hasContent: false, semantic: [], recent: [] };

function entryText(entry: BrainMemoryEntry): string {
    return (entry.content || entry.message || '').toString().trim();
}

export class BrainMemoryBridge {
    constructor(private client: BrainClient = brainClient) {}

    public isEnabled(): boolean {
        return this.client.isEnabled();
    }

    /**
     * Fetch deep context from the Brain and render it as a prompt-ready block.
     * Returns an empty block on any failure / when disabled.
     */
    public async getContextBlock(
        query: string,
        opts: { synthesize?: boolean; includeGraph?: boolean; signal?: AbortSignal } = {},
    ): Promise<BrainContextBlock> {
        if (!this.client.isEnabled() || !query?.trim()) return EMPTY_BLOCK;
        if (!(await this.client.isAvailable())) return EMPTY_BLOCK;

        const ctx = await this.client.getReasoningContext(query, {
            synthesize: opts.synthesize ?? false,
            includeGraph: opts.includeGraph ?? false,
            signal: opts.signal,
        });
        if (!ctx) return EMPTY_BLOCK;

        return this.renderContext(ctx);
    }

    /** Render a BrainReasoningContext into a BrainContextBlock (pure, testable). */
    public renderContext(ctx: BrainReasoningContext): BrainContextBlock {
        const semantic = (ctx.semantic || []).filter((e) => entryText(e));
        const recent = (ctx.recent || []).filter((e) => entryText(e));
        const synthesis = ctx.synthesis?.trim() || undefined;

        if (!semantic.length && !recent.length && !synthesis) return EMPTY_BLOCK;

        let text = '\n[SILHOUETTE BRAIN — EXTERNAL 4-TIER MEMORY]\n';
        if (synthesis) {
            text += `\n--- BRAIN SYNTHESIS ---\n${synthesis}\n`;
        }
        if (semantic.length) {
            text += '\n--- BRAIN DEEP/SEMANTIC RECALL ---\n';
            text += semantic.map((e) => {
                const score = e.score ?? e.similarity;
                const tag = typeof score === 'number' ? ` (${score.toFixed(2)})` : '';
                return `- ${entryText(e)}${tag}`;
            }).join('\n') + '\n';
        }
        if (recent.length) {
            text += '\n--- BRAIN RECENT EPISODES ---\n';
            text += recent.map((e) => `- ${entryText(e)}`).join('\n') + '\n';
        }

        return { text, hasContent: true, semantic, recent, synthesis };
    }

    /**
     * Mirror a memory into the Brain. Still never throws toward the caller,
     * but now RETURNS the real outcome so an observer can record it BEFORE
     * the caller's historical absorbing catch:
     * - 'disabled': client disabled by config (producer no-op, NOT a loss);
     * - 'empty': blank text (producer no-op, NOT a loss);
     * - 'ok': the Brain answered status ok;
     * - 'unverified-null': the client returned null - its request layer
     *   already erased the HTTP/timeout cause, so the original error is NOT
     *   recovered here and is never claimed to be;
     * - 'not-ok': the Brain answered with a non-ok status.
     */
    public mirrorMemory(
        text: string,
        opts: { importance?: number; tags?: string[]; tier?: 'WORKING' | 'MEDIUM' | 'LONG' | 'DEEP' } = {},
    ): Promise<'ok' | 'disabled' | 'empty' | 'not-ok' | 'unverified-null'> {
        if (!this.client.isEnabled()) return Promise.resolve('disabled');
        if (!text?.trim()) return Promise.resolve('empty');
        return this.client.addMemory(text, opts).then((res) => {
            if (res?.status === 'ok') {
                log.debug({ id: res.id }, 'Mirrored memory to Brain');
                return 'ok' as const;
            }
            return res === null ? 'unverified-null' as const : 'not-ok' as const;
        }).catch(() => 'unverified-null' as const);
    }
}

export const brainBridge = new BrainMemoryBridge();
