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
import { graph } from './graphService';
import { continuum } from './continuumMemory';
import { MemoryTier } from '../types';

interface ExtractedFact {
    type: 'PERSONAL' | 'PREFERENCE' | 'FACT' | 'RELATIONSHIP' | 'REMINDER';
    content: string;
    confidence: number;
    subject?: string;    // Who/what the fact is about
    attribute?: string;  // What aspect (name, preference, etc.)
    value?: string;      // The actual value
}

interface MemoryAction {
    action: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';
    fact: ExtractedFact;
    existingId?: string;
    reason: string;
}

class FactExtractionService {
    private readonly EXTRACTION_PROMPT = `You are a memory extraction system for an AI assistant named Silhouette. Analyze the conversation and extract facts that should be remembered permanently.

CRITICAL IDENTITY RULES:
1. The USER is a human named Alberto (also called Beto). He is the creator of Silhouette.
2. SILHOUETTE is the AI assistant (you). Never confuse these identities.
3. Facts about the USER should be phrased in THIRD PERSON: "The user's name is Alberto" NOT "My name is Alberto"
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
    "value": "the value"
  }
]

If there are NO facts worth remembering, output: []

CONVERSATION:
`;

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

            const prompt = this.EXTRACTION_PROMPT + `
User: ${userMessage}
Assistant: ${assistantResponse}

FACTS (JSON only):`;

            // Use local Ollama for speed and cost (this runs on every message)
            let response = '';

            if (await ollamaService.isAvailable()) {
                response = await ollamaService.generateSimpleResponse(prompt);
            } else {
                // Fallback to cloud if local unavailable
                const { geminiService } = await import('./geminiService');
                response = await geminiService.generateText(prompt);
            }

            // Parse JSON response
            const facts = this.parseFactsResponse(response);

            if (facts.length > 0) {
                console.log(`[FACT_EXTRACT] ✅ Found ${facts.length} memorable facts`);
            }

            return facts;
        } catch (e) {
            console.warn('[FACT_EXTRACT] ⚠️ Extraction failed:', e);
            return [];
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
                confidence: f.confidence || 0.7,
                subject: f.subject,
                attribute: f.attribute,
                value: f.value
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
                const { geminiService } = await import('./geminiService');
                corrected = await geminiService.generateText(validationPrompt);
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
    async processAndStore(facts: ExtractedFact[]): Promise<MemoryAction[]> {
        const actions: MemoryAction[] = [];

        for (const fact of facts) {
            // [NEW] Validate and correct before processing
            const validatedFact = await this.validateAndCorrect(fact);
            if (!validatedFact) continue; // Skip rejected facts

            const action = await this.decideAction(validatedFact);
            actions.push(action);

            // Execute the action
            if (action.action === 'ADD') {
                await this.storeFact(validatedFact);
            } else if (action.action === 'UPDATE' && action.existingId) {
                await this.updateFact(action.existingId, validatedFact);
            } else if (action.action === 'DELETE' && action.existingId) {
                await this.deleteFact(action.existingId);
            }
        }

        return actions;
    }

    /**
     * Decide what to do with a fact (ADD/UPDATE/DELETE/NOOP)
     */
    private async decideAction(fact: ExtractedFact): Promise<MemoryAction> {
        try {
            // 1. Search for similar existing facts
            const similar = await this.findSimilarFacts(fact);

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
    private async findSimilarFacts(fact: ExtractedFact): Promise<any[]> {
        try {
            // Query Neo4j for facts with same attribute
            const results = await graph.runQuery(`
                MATCH (f:Fact)
                WHERE f.attribute = $attribute OR f.content CONTAINS $keyword
                RETURN f.id as id, f.content as content, f.attribute as attribute, f.value as value
                LIMIT 5
            `, {
                attribute: fact.attribute || '',
                keyword: fact.subject || fact.value || ''
            });

            return results || [];
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
    private async storeFact(fact: ExtractedFact): Promise<void> {
        const id = crypto.randomUUID();

        // 1. Store in Neo4j (graph - for relationships and querying)
        try {
            await graph.runQuery(`
                CREATE (f:Fact {
                    id: $id,
                    type: $type,
                    content: $content,
                    subject: $subject,
                    attribute: $attribute,
                    value: $value,
                    confidence: $confidence,
                    createdAt: timestamp(),
                    source: 'CONVERSATION'
                })
            `, {
                id,
                type: fact.type,
                content: fact.content,
                subject: fact.subject || null,
                attribute: fact.attribute || null,
                value: fact.value || null,
                confidence: fact.confidence
            });

            // Link to User node if personal
            if (fact.type === 'PERSONAL' || fact.type === 'PREFERENCE') {
                await graph.runQuery(`
                    MATCH (u:User {id: 'user_primary'}), (f:Fact {id: $factId})
                    MERGE (u)-[:HAS_FACT]->(f)
                `, { factId: id });
            }

            console.log(`[FACT_EXTRACT] 📝 Stored in Neo4j: "${fact.content}"`);
        } catch (e) {
            console.warn('[FACT_EXTRACT] Neo4j storage failed:', e);
        }

        // 2. Store in ContinuumMemory (vector - for semantic search)
        await continuum.store(
            fact.content,
            MemoryTier.LONG,  // Long-term = permanent
            ['FACT', 'USER', fact.type, `attr:${fact.attribute || 'general'}`]
        );

        console.log(`[FACT_EXTRACT] 💾 Fact stored eternally: "${fact.content}"`);
    }

    /**
     * Update an existing fact
     */
    private async updateFact(id: string, fact: ExtractedFact): Promise<void> {
        try {
            await graph.runQuery(`
                MATCH (f:Fact {id: $id})
                SET f.content = $content,
                    f.value = $value,
                    f.confidence = $confidence,
                    f.updatedAt = timestamp()
            `, {
                id,
                content: fact.content,
                value: fact.value || null,
                confidence: fact.confidence
            });

            console.log(`[FACT_EXTRACT] 🔄 Updated fact: "${fact.content}"`);
        } catch (e) {
            console.warn('[FACT_EXTRACT] Update failed:', e);
        }
    }

    /**
     * Delete a fact
     */
    private async deleteFact(id: string): Promise<void> {
        try {
            await graph.runQuery(`
                MATCH (f:Fact {id: $id})
                DETACH DELETE f
            `, { id });

            console.log(`[FACT_EXTRACT] 🗑️ Deleted fact: ${id}`);
        } catch (e) {
            console.warn('[FACT_EXTRACT] Delete failed:', e);
        }
    }

    /**
     * Retrieve all facts about the user
     * Call this when assembling context
     */
    async getUserFacts(): Promise<string> {
        try {
            const results = await graph.runQuery(`
                MATCH (u:User)-[:HAS_FACT]->(f:Fact)
                RETURN f.type as type, f.content as content, f.attribute as attribute, f.value as value
                ORDER BY f.createdAt DESC
                LIMIT 20
            `);

            if (!results || results.length === 0) return '';

            const facts = results.map((r: any) => `- ${r.content}`).join('\n');
            return `[USER FACTS]\n${facts}`;
        } catch {
            return '';
        }
    }
}

export const factExtractor = new FactExtractionService();
