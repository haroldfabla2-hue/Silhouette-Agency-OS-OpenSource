/**
 * Single source of truth for LLM model defaults.
 *
 * Every literal here was verified live on 2026-10-13 against the provider's
 * own /models listing AND a real inference call (chat models) or a real
 * embedContent call (embedding models) with the project's API keys:
 *   - gemini-3.8-flash: generateContent 200 (gemini-2.0-flash / gemini-2.5-flash
 *     return 404; gemini-2.0-flash-exp was removed from the API)
 *   - openai/gpt-oss-120b: Groq chat/completions 200 (llama-3.3-70b-versatile retired)
 *   - nvidia/nemotron-3-super-120b-a12b:free: OpenRouter chat/completions 200,
 *     :free tier (the previous default, openai/gpt-4o-mini, is a paid model)
 *   - gemini-embedding-001 / gemini-embedding-2: embedContent 200
 *     (text-embedding-004 and embedding-001 return 404)
 *
 * Env overrides: GEMINI_MODEL / GEMINI_EMBEDDING_MODEL are read here because the
 * GEMINI provider uses the legacy transport, which the registry's modelEnv
 * mechanism does not cover. GROQ_MODEL / OPENROUTER_MODEL / NVIDIA_MODEL are
 * consumed by the openai-compatible transport via providerRegistry modelEnv.
 */
export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
/**
 * Background/non-stream tasks get their own model: per-model quota buckets drain
 * independently (verified live 2026-10-15: gemini-3.5-flash non-stream 429s while
 * gemini-3.1-flash-lite non-stream answers 200 with the same key).
 */
export const DEFAULT_GEMINI_BACKGROUND_MODEL = process.env.GEMINI_BACKGROUND_MODEL?.trim() || 'gemini-3.1-flash-lite';
/**
 * 'pro' chat preference: verified present in the key's models.list 2026-10-16
 * (gemini-1.5-pro, the previous literal, is gone from the API).
 */
export const DEFAULT_GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL?.trim() || 'gemini-3.1-pro-preview';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001';
export const FALLBACK_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2';
/**
 * Keep embeddings at 768 dimensions: lancedbService.DEFAULT_DIMENSIONS and the
 * existing vector tables are fixed at 768. gemini-embedding-001/2 accept
 * outputDimensionality, so we request 768 instead of their native 3072.
 */
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
