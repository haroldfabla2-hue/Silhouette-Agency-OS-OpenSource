// Actual embedding resolver. Importing memory search must not boot agent orchestration.
import { ensureClient } from './geminiClientState';
import { localEmbeddingService } from './localEmbeddingService';
import { LOCAL_EMBEDDING_IDENTITY, geminiIdentity, type EmbeddingIdentity } from './embeddingIdentity';
import { DEFAULT_GEMINI_EMBEDDING_MODEL, FALLBACK_GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_DIMENSIONS } from './llm/defaultModels';
import { quotaLedger } from './quotaLedger';
import { localInferenceAllowed } from './security/localInferencePolicy';

let consecutiveEmbeddingFailures = 0;
let isLocalEmbeddingPrimary = false;

export const generateEmbedding = async (text: string): Promise<number[] | null> => {
    const embedded = await generateEmbeddingWithIdentity(text);
    return embedded?.vector ?? null;
};

/**
 * Embedding + TRUE identity (the model and dimension that actually produced
 * the vector: Gemini primary, Gemini fallback, or the local all-MiniLM-L6-v2
 * engine). Callers that persist or query vectors must use this so write and
 * read identities can never silently diverge.
 */
export const generateEmbeddingWithIdentity = async (text: string, opts?: { allowFallbackIdentity?: boolean; preReserved?: boolean }): Promise<{ vector: number[]; identity: EmbeddingIdentity } | null> => {
    // Memory-persistence callers pass allowFallbackIdentity:false: a vector from
    // a DIFFERENT model must never be silently substituted into the canonical
    // memory index (one identity space per collection). Strict mode returns null
    // instead - the row stays EMBEDDING_PENDING and is retried when the real
    // provider recovers. Strict mode also never feeds the 3-strikes latch, so a
    // memory-path outage cannot silently switch identity for every other caller.
    // Validate policy outside provider catches. A stale mixed-mode latch must
    // never prevent an ordinary cloud-only request from trying its cloud path.
    const localAllowed = localInferenceAllowed();
    if (!localAllowed) isLocalEmbeddingPrimary = false;
    const allowFallbackIdentity = opts?.allowFallbackIdentity !== false;
    const localFallback = async (): Promise<{ vector: number[]; identity: EmbeddingIdentity } | null> => {
        // Recheck current policy at the effect boundary after any cloud await.
        // Denial never makes another cloud request or invents an embedding.
        const permittedNow = localInferenceAllowed();
        if (!permittedNow) isLocalEmbeddingPrimary = false;
        if (!allowFallbackIdentity || !permittedNow) {
            console.warn('[EMBEDDING] Local fallback not selected by policy or identity; embedding unavailable');
            return null;
        }
        const localVector = await localEmbeddingService.getEmbedding(text);
        return localVector ? { vector: localVector, identity: LOCAL_EMBEDDING_IDENTITY } : null;
    };

    if (isLocalEmbeddingPrimary) {
        if (!allowFallbackIdentity) return null;
        return localFallback();
    }

    const client = ensureClient();
    if (!client) {
        if (!allowFallbackIdentity) return null;
        // Fallback to local Transformers.js embedding (all-MiniLM-L6-v2)
        if (localInferenceAllowed()) console.log("[GeminiService] 🔌 Using Local Embedding Fallback for:", text.substring(0, 30));
        return localFallback();
    }

    try {
        // [PR-K parity] Embedding attempts count against the SAME local daily
        // budget ledger as text generation - attempts are what provider quota
        // charges. Budget spent => degrade honestly BEFORE burning a real call.
        // [QUOTA-COOLDOWN] A real provider 429 (RetryInfo) outranks the local
        // ledger: never burn calls against a provider-declared cooldown.
        const cooldown = quotaLedger.cooldownUntil('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
        if (cooldown) {
            console.warn(`[GeminiService] provider cooldown active for gemini:${DEFAULT_GEMINI_EMBEDDING_MODEL} until ${new Date(cooldown).toISOString()} (real 429 RetryInfo) - no call burned`);
            if (!allowFallbackIdentity) return null;
            return localFallback();
        }
        // preReserved: caller (backfill governor) already counted this
        // attempt atomically; recording again would double-count.
        const qPrimary = opts?.preReserved
            ? quotaLedger.status('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL)
            : quotaLedger.recordAttempt('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
        if (!qPrimary.allowed) {
            console.warn(`[GeminiService] QUOTA_BUDGET_EXCEEDED: local daily budget for gemini:${DEFAULT_GEMINI_EMBEDDING_MODEL} spent (${qPrimary.used}/${qPrimary.budget} attempts, day ${qPrimary.day}). Degrading honestly until quota reset.`);
            if (!allowFallbackIdentity) return null;
            return localFallback();
        }

        try {
            const result = await client.models.embedContent({
                model: DEFAULT_GEMINI_EMBEDDING_MODEL,
                contents: [{ parts: [{ text }] }],
                config: { outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS }
            });
            const embedding = result.embeddings?.[0]?.values;
            if (embedding) {
                consecutiveEmbeddingFailures = 0; // Reset on success
                return { vector: embedding, identity: geminiIdentity(DEFAULT_GEMINI_EMBEDDING_MODEL) };
            }
        } catch (e: any) {
            // [ROBUSTNESS] Handle both Error objects and raw JSON error responses
            const errorMsg = e.message || JSON.stringify(e);

            if (!allowFallbackIdentity) {
                console.warn(`[GeminiService] Embedding API failed in strict-identity mode (row stays EMBEDDING_PENDING, no substitution): ${errorMsg}`);
                return null;
            }

            // Fallback to older model if 004 not found (404)
            if (errorMsg.includes('404') || errorMsg.includes('not found') || errorMsg.includes('NOT_FOUND')) {
                console.warn(`[GeminiService] ⚠️ ${DEFAULT_GEMINI_EMBEDDING_MODEL} not found, falling back to ${FALLBACK_GEMINI_EMBEDDING_MODEL}...`);
                try {
                    const qFallback = quotaLedger.recordAttempt('gemini', FALLBACK_GEMINI_EMBEDDING_MODEL);
                    if (!qFallback.allowed) {
                        console.warn(`[GeminiService] QUOTA_BUDGET_EXCEEDED: local daily budget for gemini:${FALLBACK_GEMINI_EMBEDDING_MODEL} spent (${qFallback.used}/${qFallback.budget} attempts, day ${qFallback.day}).`);
                        return localFallback();
                    }
                    const result = await client.models.embedContent({
                        model: FALLBACK_GEMINI_EMBEDDING_MODEL,
                        contents: [{ parts: [{ text }] }],
                        config: { outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS }
                    });
                    const embedding = result.embeddings?.[0]?.values;
                    if (embedding) {
                        consecutiveEmbeddingFailures = 0; // Reset on success
                        return { vector: embedding, identity: geminiIdentity(FALLBACK_GEMINI_EMBEDDING_MODEL) };
                    }
                } catch (fallbackError: any) {
                    consecutiveEmbeddingFailures++;
                    console.error(`[GeminiService] ❌ Fallback Embedding ${FALLBACK_GEMINI_EMBEDDING_MODEL} also failed:`, fallbackError.message || fallbackError);

                    if (localInferenceAllowed() && consecutiveEmbeddingFailures >= 3) {
                        isLocalEmbeddingPrimary = true;
                        console.warn("[GeminiService] 🚨 3 Consecutive API Embedding Failures. Permanently switching to Local Embedding Engine.");
                    } else if (localInferenceAllowed()) {
                        console.log(`[GeminiService] 🔌 Falling back to Local Embedding Engine (${consecutiveEmbeddingFailures}/3 strikes)...`);
                    }
                    return localFallback();
                }
            } else {
                consecutiveEmbeddingFailures++;
                console.error("[GeminiService] ❌ Embedding API Failed:", errorMsg);
                // [QUOTA-COOLDOWN] Real 429: record the provider-declared
                // RetryInfo as a durable cooldown so every route (backfill,
                // live writes, autonomous scheduler) stops burning calls.
                if (/429|RESOURCE_EXHAUSTED|quota exceeded/i.test(errorMsg)) {
                    const m = errorMsg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
                    if (m) {
                        quotaLedger.recordCooldown('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL,
                            Date.now() + Math.ceil(Number(m[1])) * 1000, 'provider 429 RetryInfo');
                    }
                }

                if (localInferenceAllowed() && consecutiveEmbeddingFailures >= 3) {
                    isLocalEmbeddingPrimary = true;
                    console.warn("[GeminiService] 🚨 3 Consecutive API Embedding Failures. Permanently switching to Local Embedding Engine.");
                } else if (localInferenceAllowed()) {
                    console.log(`[GeminiService] 🔌 Falling back to Local Embedding Engine (${consecutiveEmbeddingFailures}/3 strikes)...`);
                }
                return localFallback();
            }
        }

        return null;
    } catch (e: any) {
        if (!allowFallbackIdentity) {
            console.warn(`[GeminiService] Embedding failed in strict-identity mode (row stays EMBEDDING_PENDING, no substitution):`, e?.message || e);
            return null;
        }
        consecutiveEmbeddingFailures++;
        console.error("[GeminiService] ❌ Critical Embedding Failure:", e?.message || e);

        if (localInferenceAllowed() && consecutiveEmbeddingFailures >= 3) {
            isLocalEmbeddingPrimary = true;
            console.warn("[GeminiService] 🚨 3 Consecutive API Embedding Failures. Permanently switching to Local Embedding Engine.");
        } else if (localInferenceAllowed()) {
            console.log(`[GeminiService] 🔌 Falling back to Local Embedding Engine (${consecutiveEmbeddingFailures}/3 strikes)...`);
        }
        return localFallback();
    }
};
