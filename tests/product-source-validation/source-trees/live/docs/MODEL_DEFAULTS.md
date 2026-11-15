# Model defaults (live-verified)

Every default below was verified on **2026-10-13** against the provider's own
`/models` listing **and** a real inference call (chat) or `embedContent` call
(embeddings) with the project API keys. Models are deprecated by vendors
without notice, so these defaults are expected to need periodic re-verification.

| Provider | Default | Override env | Notes |
|---|---|---|---|
| Gemini (chat) | `gemini-3.8-flash` | `GEMINI_MODEL` | `gemini-2.0-flash`, `gemini-2.5-flash` and `gemini-2.0-flash-exp` return 404/are removed |
| Gemini (embeddings) | `gemini-embedding-001` | `GEMINI_EMBEDDING_MODEL` | Requested with `outputDimensionality: 768` to match the LanceDB schema; fallback `gemini-embedding-2` |
| Groq | `openai/gpt-oss-120b` | `GROQ_MODEL` | `llama-3.3-70b-versatile` was retired |
| OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` | `OPENROUTER_MODEL` | `:free` tier, no billing. Previous default `openai/gpt-4o-mini` is a paid model |

The single source of truth in code is `services/llm/defaultModels.ts`.
`tests/automated/default-models.test.ts` guards the registry, the stream
adapter and the env overrides against drift.

## Why env overrides

`GEMINI` runs on the legacy transport, which the registry's `modelEnv`
mechanism does not cover, so `GEMINI_MODEL` / `GEMINI_EMBEDDING_MODEL` are read
in `defaultModels.ts`. `GROQ_MODEL` / `OPENROUTER_MODEL` / `NVIDIA_MODEL` are
consumed by the openai-compatible transport (`openAICompatible.ts`).

## Wizard note

`scripts/bootstrap.ts` only writes values the user actually entered into
`.env.local`. An empty `KEY=` line shadows the real key from `.env` (dotenv
does not override), leaving providers `NOT_CONFIGURED` even with a valid key
in `.env`. `scripts/setup.ts` already behaved this way.
