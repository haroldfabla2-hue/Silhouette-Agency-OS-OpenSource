/**
 * FACT EXTRACTION SERVICE (Mem0-style)
 * ═══════════════════════════════════════════════════════════════
 * Intelligent extraction of memorable facts from conversations.
 * Uses LLM to identify what should be remembered permanently.
 * 
 * Based on Mem0 architecture:
 * 1. EXTRACT: Identify facts from conversation
 * 2. COMPARE: Check against existing facts
 * 3. DECIDE: ADD, UPDATE, DELETE, or NOOP
 * 
 * Storage: Neo4j (graph) + Qdrant (vectors) = Eternal Memory
 */

import { ollamaService } from './ollamaService';
import { factRepository } from './memory/factRepository';

interface ExtractedFact {
    type: 'PERSONAL' | 'PREFERENCE' | 'FACT' | 'RELATIONSHIP' | 'REMINDER';
    content: string;
    confidence: number;
    subject?: string;    // Who/what the fact is about
    attribute?: string;  // What aspect (name, preference, etc.)
    value?: string;      // The actual value
    /** Provenance: USER_STATED = the user said it; USER_INFERRED = derived from the assistant's own words (unverified). */
    source?: 'USER_STATED' | 'USER_INFERRED';
    /** Exact span of the USER's message backing this fact (mandatory for USER_STATED). */
    quote?: string;
}

interface MemoryAction {
    action: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';
    fact: ExtractedFact;
    existingId?: string;
    reason: string;
}

export class FactExtractionService {
    // [R2] Deferred extraction: a failed attempt is retried later, never silently lost.
    private pendingDeferred = 0;
    private readonly MAX_DEFERRED = 25;
    private readonly DEFER_DELAY_MS = 60000;
    private readonly MAX_EXTRACT_ATTEMPTS = 2;

    /**
     * Extraction + storage as one deferred-capable unit (R2: "diferir extracción
     * sin perderla"). On failure the turn's extraction is retried once after
     * DEFER_DELAY_MS; it is only dropped after MAX_EXTRACT_ATTEMPTS, with a loud log.
     */
    async extractAndStore(userMessage: string, assistantResponse: string, userId: string, attempt = 1): Promise<void> {
        try {
            const facts = await this.extractFromConversation(userMessage, assistantResponse);
            if (facts.length > 0) {
                await this.processAndStore(facts, userId, userMessage);
            }
        } catch (e) {
            console.warn(`[FACT_EXTRACT] ⚠️ extractAndStore failed (attempt ${attempt}/${this.MAX_EXTRACT_ATTEMPTS}):`, e);
            this.deferExtraction(userMessage, assistantResponse, userId, attempt + 1);
        }
    }

    private deferExtraction(userMessage: string, assistantResponse: string, userId: string, attempt: number): void {
        if (attempt > this.MAX_EXTRACT_ATTEMPTS) {
            console.warn('[FACT_EXTRACT] 🛑 Extraction dropped after retries; facts for this turn are lost (explicit).');
            return;
        }
        if (this.pendingDeferred >= this.MAX_DEFERRED) {
            console.warn('[FACT_EXTRACT] 🛑 Deferred queue full; dropping oldest-capable retry (explicit).');
            return;
        }
        this.pendingDeferred++;
        const timer = setTimeout(() => {
            this.pendingDeferred--;
            void this.extractAndStore(userMessage, assistantResponse, userId, attempt);
        }, this.DEFER_DELAY_MS);
        timer.unref?.();
        console.log(`[FACT_EXTRACT] ⏳ Extraction deferred (attempt ${attempt} in ${this.DEFER_DELAY_MS / 1000}s, pending: ${this.pendingDeferred})`);
    }

    private getExtractionPrompt(): string {
        // Dynamically resolve the creator's name from the identity service
        let creatorName = 'the user';
        try {
            const { identityService } = require('./identityService');
            creatorName = identityService.getCreatorName() || 'the user';
        } catch {
            // identityService not yet initialized - use fallback
        }

        return `You are a memory extraction system for an AI assistant named Silhouette. Analyze the conversation and extract facts that should be remembered permanently.

CRITICAL IDENTITY RULES:
1. The USER is a human named ${creatorName}. They are the creator of Silhouette.
2. SILHOUETTE is the AI assistant (you). Never confuse these identities.
3. Facts about the USER should be phrased in THIRD PERSON: "The user's name is ${creatorName}" NOT "My name is ${creatorName}"
4. Facts about SILHOUETTE should be phrased as: "Silhouette can..." NOT "I can..."
5. NEVER extract facts where USER claims to be Silhouette or vice versa.

EXTRACT facts about:
- User's personal info (name, age, location, profession)
- User's preferences (likes, dislikes, habits)
- Important facts the user shares ("my dog is named Max" → "The user's dog is named Max")
- Relationships ("my wife is Maria" → "The user's wife is Maria")
- Explicit memory requests ("remember that...", "don't forget...")

QUALITY RULES:
- Write in grammatically correct Spanish or English (match the conversation language)
- NO typos or spelling errors
- Be concise but complete
- If unsure about a fact, set confidence below 0.5

OUTPUT FORMAT (JSON array):
[
  {
    "type": "PERSONAL|PREFERENCE|FACT|RELATIONSHIP|REMINDER",
    "content": "Third-person sentence describing the fact about the USER",
    "confidence": 0.0-1.0,
    "subject": "USER or SILHOUETTE or other",
    "attribute": "what aspect",
    "value": "the value",
    "source": "user | assistant",
    "quote": "exact span of the USER's message that states this fact (empty for assistant)"
  }
]

PROVENANCE RULE (mandatory):
- source="user" ONLY if the USER explicitly stated the fact in their own message, and then
  "quote" MUST be the exact substring of the user's message that says it (copy, do not paraphrase).
- source="assistant" if the fact comes from the ASSISTANT's words (suggestions, assumptions, confirmations the user did not state). These are stored as UNVERIFIED inferences, never as user statements.
- A fact whose quote is not a real substring of the user's message will be DOWNGRADED to an unverified inference automatically.

If there are NO facts worth remembering, output: []

CONVERSATION:
`;
    }

    /**
     * Extract facts from a conversation turn
     * Call this after each user message
     */
    async extractFromConversation(
        userMessage: string,
        assistantResponse: string
    ): Promise<ExtractedFact[]> {
        try {
            console.log('[FACT_EXTRACT] 🔍 Analyzing conversation for memorable facts...');

            const prompt = this.getExtractionPrompt() + `
User: ${userMessage}
Assistant: ${assistantResponse}

FACTS (JSON only):`;

            // Use local Ollama for speed and cost (this runs on every message)
            let response = '';

            if (await ollamaService.isAvailable()) {
                response = await ollamaService.generateSimpleResponse(prompt);
            } else {
                // Fallback to cloud if local unavailable (R1: unified chain via the inference router)
                const { agentInferenceRouter } = await import('./llm/agentInferenceRouter');
                response = await agentInferenceRouter.completeText(prompt);
            }

            // Parse JSON response
            const facts = this.parseFactsResponse(response);

            if (facts.length > 0) {
                console.log(`[FACT_EXTRACT] ✅ Found ${facts.length} memorable facts`);
            }

            return facts;
        } catch (e) {
            console.warn('[FACT_EXTRACT] ⚠️ Extraction failed:', e);
            throw e; // [R2] the caller (extractAndStore) defers the retry; a silent [] used to lose the turn's facts
        }
    }

    /**
     * Parse LLM response into structured facts
     */
    private parseFactsResponse(response: string): ExtractedFact[] {
        try {
            // Find JSON array in response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) return [];

            return parsed.filter(f =>
                f.content &&
                f.type &&
                (f.confidence === undefined || f.confidence >= 0.5)
            ).map(f => ({
                type: f.type || 'FACT',
                content: f.content,
                // Assistant-sourced facts are unverified inferences: cap confidence.
                confidence: f.source === 'assistant' ? Math.min(f.confidence || 0.7, 0.6) : (f.confidence || 0.7),
                subject: f.subject,
                attribute: f.attribute,
                value: f.value,
                source: f.source === 'assistant' ? 'USER_INFERRED' as const : 'USER_STATED' as const,
                quote: typeof f.quote === 'string' && f.quote.trim() ? f.quote.trim() : undefined
            }));
        } catch {
            return [];
        }
    }

    /**
     * Validate and correct facts before storage
     * Uses LLM to fix typos, grammar, and perspective issues
     */
    private async validateAndCorrect(fact: ExtractedFact): Promise<ExtractedFact | null> {
        const validationPrompt = `You are a grammar and spelling corrector. Fix any errors in this fact.

RULES:
1. Fix spelling and grammar errors
2. Ensure third-person perspective for user facts ("The user..." not "I...")
3. If the fact is about Silhouette (the AI), phrase as "Silhouette can..." not "I can..."
4. Return ONLY the corrected "content" string, nothing else
5. If the fact is fundamentally confusing or wrong, return "REJECT"

ORIGINAL FACT:
"${fact.content}"

CORRECTED (or REJECT):`;

        try {
            let corrected = '';
            if (await ollamaService.isAvailable()) {
                corrected = await ollamaService.generateSimpleResponse(validationPrompt);
            } else {
                const { agentInferenceRouter } = await import('./llm/agentInferenceRouter');
                corrected = await agentInferenceRouter.completeText(validationPrompt);
            }

            corrected = corrected.trim().replace(/^["']|["']$/g, ''); // Remove quotes

            if (corrected === 'REJECT' || corrected.toLowerCase().includes('reject')) {
                console.log(`[FACT_EXTRACT] 🚫 Rejected invalid fact: "${fact.content.substring(0, 40)}..."`);
                return null;
            }

            if (corrected !== fact.content) {
                console.log(`[FACT_EXTRACT] ✏️ Corrected: "${fact.content.substring(0, 30)}..." → "${corrected.substring(0, 30)}..."`);
            }

            return { ...fact, content: corrected };
        } catch (e) {
            // On error, return original (fail-open)
            return fact;
        }
    }

    /**
     * Process extracted facts: validate, compare with existing, and decide action
     */
    async processAndStore(facts: ExtractedFact[], userId: string, userMessage?: string): Promise<MemoryAction[]> {
        const actions: MemoryAction[] = [];

        for (const fact of facts) {
            // [R5] Citation check: USER_STATED requires the quote to literally
            // appear in the user's message. The model's declared source is not
            // evidence; without a verifiable citation the fact is a hypothesis.
            const cited = this.verifyCitation(fact, userMessage);
            if (!cited) continue; // dropped with loud log inside

            // [NEW] Validate and correct before processing
            const validatedFact = await this.validateAndCorrect(cited);
            if (!validatedFact) continue; // Skip rejected facts

            const action = await this.decideAction(validatedFact, userId);
            actions.push(action);

            // Execute the action
            if (action.action === 'ADD') {
                await this.storeFact(validatedFact, userId);
            } else if (action.action === 'UPDATE' && action.existingId) {
                await this.updateFact(action.existingId, validatedFact, userId);
            } else if (action.action === 'DELETE' && action.existingId) {
                await this.deleteFact(action.existingId, userId);
            }
        }

        return actions;
    }

    /**
     * [R5] Verify the citation behind a USER_STATED fact. Returns the fact
     * possibly downgraded to USER_INFERRED (hypothesis) when the quote does
     * not literally appear in the user's message; returns null only when an
     * inferred fact has no usable content.
     */
    private verifyCitation(fact: ExtractedFact, userMessage?: string): ExtractedFact | null {
        if (fact.source !== 'USER_STATED') return fact;
        const quote = (fact.quote || '').trim();
        if (userMessage && quote && userMessage.toLowerCase().includes(quote.toLowerCase())) {
            return fact; // citation verified: the user really said this
        }
        console.warn(`[FACT_EXTRACT] 🔽 Downgraded to inference (no verifiable quote): "${fact.content.substring(0, 50)}..."`);
        return { ...fact, source: 'USER_INFERRED', quote: undefined, confidence: Math.min(fact.confidence, 0.6) };
    }

    /**
     * Decide what to do with a fact (ADD/UPDATE/DELETE/NOOP)
     */
    private async decideAction(fact: ExtractedFact, userId: string): Promise<MemoryAction> {
        try {
            // 1. Search for similar existing facts (owner-scoped: R5)
            const similar = await this.findSimilarFacts(fact, userId);

            if (similar.length === 0) {
                return { action: 'ADD', fact, reason: 'New fact' };
            }

            const existing = similar[0];

            // 2. Check if it's a contradiction (e.g., "my name is X" vs "my name is Y")
            if (fact.attribute && existing.attribute === fact.attribute) {
                if (fact.value !== existing.value) {
                    return {
                        action: 'UPDATE',
                        fact,
                        existingId: existing.id,
                        reason: `Updating ${fact.attribute} from "${existing.value}" to "${fact.value}"`
                    };
                }
            }

            // 3. Check if it's essentially the same
            if (this.isSameFact(fact, existing)) {
                return { action: 'NOOP', fact, reason: 'Already known' };
            }

            // 4. Default: add as new (complementary info)
            return { action: 'ADD', fact, reason: 'Additional info' };

        } catch (e) {
            console.warn('[FACT_EXTRACT] Decision error:', e);
            return { action: 'ADD', fact, reason: 'Fallback to add' };
        }
    }

    /**
     * Find similar facts in storage
     */
    private async findSimilarFacts(fact: ExtractedFact, userId: string): Promise<any[]> {
        try {
            // [R5] SQLite repository, owner-scoped (was: graph query across ALL owners)
            return factRepository.findSimilar(fact, userId);
        } catch {
            return [];
        }
    }

    /**
     * Check if two facts are semantically the same
     */
    private isSameFact(a: ExtractedFact, b: any): boolean {
        if (a.attribute && b.attribute) {
            return a.attribute === b.attribute && a.value === b.value;
        }
        // Fuzzy content match
        const contentA = a.content.toLowerCase();
        const contentB = (b.content || '').toLowerCase();
        return contentA === contentB ||
            contentA.includes(contentB) ||
            contentB.includes(contentA);
    }

    /**
     * Store a new fact permanently
     */
    private async storeFact(fact: ExtractedFact, userId: string): Promise<void> {
        // [R5] Repository: SQLite durable source + graph/continuum projections
        // under one shared id, with an honest receipt per backend.
        const receipt = await factRepository.addFact({
            type: fact.type,
            content: fact.content,
            subject: fact.subject,
            attribute: fact.attribute,
            value: fact.value,
            source: fact.source || 'USER_STATED',
            quote: fact.quote,
            status: fact.source === 'USER_STATED' ? 'verified' : 'hypothesis',
            confidence: fact.confidence
        }, userId);
        const proj = receipt.projections.map(p => `${p.backend}:${p.ok ? 'ok' : 'FAILED'}`).join(' ');
        console.log(`[FACT_EXTRACT] 💾 Fact stored (id=${receipt.id}, sqlite=${receipt.sqliteRows} row, ${proj}): "${fact.content}"`);
    }

    /**
     * Update an existing fact
     */
    private async updateFact(id: string, fact: ExtractedFact, userId: string): Promise<void> {
        const receipt = await factRepository.updateFact(id, {
            content: fact.content,
            value: fact.value,
            confidence: fact.confidence
        }, userId);
        console.log(`[FACT_EXTRACT] 🔄 Updated fact (id=${id}, sqlite=${receipt.sqliteRows} row): "${fact.content}"`);
    }

    /**
     * Delete a fact
     */
    private async deleteFact(id: string, userId: string): Promise<void> {
        const receipt = await factRepository.retractFact(id, userId);
        console.log(`[FACT_EXTRACT] 🗑️ Retracted fact (id=${id}, sqlite=${receipt.sqliteRows} row)`);
    }

    /**
     * Retrieve all facts about the user
     * Call this when assembling context
     */
    async getUserFacts(userId: string): Promise<string> {
        try {
            // [R5] read the durable source (SQLite repository), not one projection
            const results = factRepository.getFacts(userId).slice(0, 20);
            if (!results || results.length === 0) return '';

            const facts = results.map((r) => `- ${r.content}`).join('\n');
            return `[USER FACTS]\n${facts}`;
        } catch {
            return '';
        }
    }
}

export const factExtractor = new FactExtractionService();
