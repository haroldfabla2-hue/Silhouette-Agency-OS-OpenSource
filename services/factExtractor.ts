import { ResourceScope } from '../server/runtime/resourceScope';
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

interface DeferredFactExtraction {
    id:number;userMessage:string;assistantResponse:string;userId:string;attempt:number;
    state:'SCHEDULED'|'RUNNING'|'RETURNED'|'PENDING_QUIESCE'|'EXHAUSTED'|'CAPACITY_PENDING'|'UNKNOWN_STORAGE';
}
export class FactExtractionService {
    private readonly operations=new ResourceScope('fact-extraction');
    private readonly deferred:DeferredFactExtraction[]=[];
    private readonly deferredTimers=new Map<number,ReturnType<typeof setTimeout>>();
    public getLifecycleStatus(){return {pendingDurable:false,receipts:this.deferred.map(({userMessage,assistantResponse,userId,...receipt})=>({...receipt})),diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures()};}
    public getPendingExtractions(){return this.deferred.filter(r=>!['RETURNED'].includes(r.state)).map(r=>({...r}));}
    public shutdownLifecycle(){return this.operations.close();}
    constructor(){this.operations.own({name:'fact-deferred-timers',stopIntake:()=>{
        for(const [id,timer] of this.deferredTimers){clearTimeout(timer);const record=this.deferred.find(r=>r.id===id);if(record)record.state='PENDING_QUIESCE';}
        this.deferredTimers.clear();this.pendingDeferred=0;
    },close:()=>({state:'UNVERIFIED',detail:'Actual fact operations drained; deferred and uncertain storage intents remain volatile, repository/provider internals separately owned'})});}

    // Deferred scheduling limits preserved. Records are volatile, not crash durable.
    private pendingDeferred = 0;
    private readonly MAX_DEFERRED = 25;
    private readonly DEFER_DELAY_MS = 60000;
    private readonly MAX_EXTRACT_ATTEMPTS = 2;

    /** Extraction-only retries preserve the original delay/attempt/capacity.
     * Storage uncertainty is retained separately, never replayed as extraction. */
    async extractAndStore(userMessage:string,assistantResponse:string,userId:string,attempt=1):Promise<void>{
        return this.operations.run('extract-and-store',async()=>{
            let facts:ExtractedFact[];
            try{facts=await this.extractFromConversation(userMessage,assistantResponse);}
            catch(error){
                this.operations.recordDiagnostic('fact-extraction',error,'DEGRADED_FALLBACK','UNAVAILABLE');
                this.deferExtraction(userMessage,assistantResponse,userId,attempt+1);return;
            }
            if(facts.length){
                try{await this.processAndStore(facts,userId,userMessage);}
                catch(error){
                    // A repository/projection failure can follow an applied write.
                    // Keep the uncertainty rather than retry the whole conversation.
                    this.deferred.push({id:this.deferred.length+1,userMessage,assistantResponse,userId,attempt,state:'UNKNOWN_STORAGE'});
                    this.operations.recordFailure('fact-storage-outcome-unknown',error);throw error;
                }
            }
        });
    }
    private deferExtraction(userMessage:string,assistantResponse:string,userId:string,attempt:number):void{
        const record:DeferredFactExtraction={id:this.deferred.length+1,userMessage,assistantResponse,userId,attempt,state:'SCHEDULED'};
        this.deferred.push(record);
        if(!this.operations.accepting){record.state='PENDING_QUIESCE';return;}
        if(attempt>this.MAX_EXTRACT_ATTEMPTS){record.state='EXHAUSTED';this.operations.recordDiagnostic('fact-retry-exhausted',new Error('Fact extraction exhausted; pending intent retained'),'OPERATION_REJECTED','UNAVAILABLE');return;}
        if(this.pendingDeferred>=this.MAX_DEFERRED){record.state='CAPACITY_PENDING';this.operations.recordDiagnostic('fact-retry-capacity',new Error('Fact deferred scheduling capacity reached; pending intent retained'),'OPERATION_REJECTED','UNAVAILABLE');return;}
        this.pendingDeferred++;
        const timer=setTimeout(()=>{
            this.deferredTimers.delete(record.id);this.pendingDeferred--;
            if(!this.operations.accepting){record.state='PENDING_QUIESCE';return;}
            record.state='RUNNING';
            void this.extractAndStore(userMessage,assistantResponse,userId,attempt).then(()=>{
                // RETURNED is only this attempt's return. A failed extraction may
                // have created another pending/deferred record, not success.
                record.state='RETURNED';record.userMessage='';record.assistantResponse='';
            },()=>{record.state='UNKNOWN_STORAGE';});
        },this.DEFER_DELAY_MS);
        this.deferredTimers.set(record.id,timer);timer.unref?.();
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
        return this.operations.run('extractFromConversation',async()=>{

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
            this.operations.recordDiagnostic('extractFromConversation',e,'UNCLASSIFIED','UNVERIFIED');

            console.warn('[FACT_EXTRACT] ⚠️ Extraction failed:', e);
            throw e; // [R2] the caller (extractAndStore) defers the retry; a silent [] used to lose the turn's facts
        }
    
        });
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
        return this.operations.run('validateAndCorrect',async()=>{

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
            this.operations.recordDiagnostic('validateAndCorrect',e,'UNCLASSIFIED','UNVERIFIED');

            // On error, return original (fail-open)
            return fact;
        }
    
        });
    }

    /**
     * Process extracted facts: validate, compare with existing, and decide action
     */
    async processAndStore(facts: ExtractedFact[], userId: string, userMessage?: string): Promise<MemoryAction[]> {
        return this.operations.run('processAndStore',async()=>{

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
    
        });
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
        return this.operations.run('decideAction',async()=>{

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
            this.operations.recordDiagnostic('decideAction',e,'UNCLASSIFIED','UNVERIFIED');

            console.warn('[FACT_EXTRACT] Decision error:', e);
            return { action: 'ADD', fact, reason: 'Fallback to add' };
        }
    
        });
    }

    /**
     * Find similar facts in storage
     */
    private async findSimilarFacts(fact: ExtractedFact, userId: string): Promise<any[]> {
        return this.operations.run('findSimilarFacts',async()=>{

        try {
            // [R5] SQLite repository, owner-scoped (was: graph query across ALL owners)
            return factRepository.findSimilar(fact, userId);
        } catch {
            this.operations.recordDiagnostic('findSimilarFacts',new Error('Fact operation failed without original error binding'),'UNCLASSIFIED','UNVERIFIED');

            return [];
        }
    
        });
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
        return this.operations.run('storeFact',async()=>{
        try{

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
    
        }catch(error){this.operations.recordFailure('storeFact-outcome-unknown',error);throw error;}
        });
    }

    /**
     * Update an existing fact
     */
    private async updateFact(id: string, fact: ExtractedFact, userId: string): Promise<void> {
        return this.operations.run('updateFact',async()=>{
        try{

        const receipt = await factRepository.updateFact(id, {
            content: fact.content,
            value: fact.value,
            confidence: fact.confidence
        }, userId);
        console.log(`[FACT_EXTRACT] 🔄 Updated fact (id=${id}, sqlite=${receipt.sqliteRows} row): "${fact.content}"`);
    
        }catch(error){this.operations.recordFailure('updateFact-outcome-unknown',error);throw error;}
        });
    }

    /**
     * Delete a fact
     */
    private async deleteFact(id: string, userId: string): Promise<void> {
        return this.operations.run('deleteFact',async()=>{
        try{

        const receipt = await factRepository.retractFact(id, userId);
        console.log(`[FACT_EXTRACT] 🗑️ Retracted fact (id=${id}, sqlite=${receipt.sqliteRows} row)`);
    
        }catch(error){this.operations.recordFailure('deleteFact-outcome-unknown',error);throw error;}
        });
    }

    /**
     * Retrieve all facts about the user
     * Call this when assembling context
     */
    async getUserFacts(userId: string): Promise<string> {
        return this.operations.run('getUserFacts',async()=>{

        try {
            // [R5] read the durable source (SQLite repository), not one projection
            const results = factRepository.getFacts(userId).slice(0, 20);
            if (!results || results.length === 0) return '';

            const facts = results.map((r) => `- ${r.content}`).join('\n');
            return `[USER FACTS]\n${facts}`;
        } catch {
            this.operations.recordDiagnostic('getUserFacts',new Error('Fact operation failed without original error binding'),'UNCLASSIFIED','UNVERIFIED');

            return '';
        }
    
        });
    }
}

export const factExtractor = new FactExtractionService();
