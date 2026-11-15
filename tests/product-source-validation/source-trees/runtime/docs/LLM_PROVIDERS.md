# Configurable LLM providers

The gateway preserves native MiniMax, Gemini, Groq, DeepSeek, Ollama and ZhipuAI paths. New OpenAI Chat Completions-compatible providers are configuration data, not new switch cases. NVIDIA and OpenRouter presets are included. Set credentials only in the server environment, never in the registry or repository.

```sh
NVIDIA_API_KEY=<secret>
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
```

```ts
await llmGateway.complete('Public generic test', { preferredProvider: 'NVIDIA', maxTokens: 128 });
const models = await llmGateway.discoverModels('NVIDIA');
const answer = await llmGateway.chat('NVIDIA', messages, { tools, toolChoice: 'auto' });
```

`chat()` preserves function calls and tool-result messages. It does not execute tools. `complete()`/`stream()` are text APIs and reject tool responses rather than silently discard them. The transport's event stream supports text, tool deltas and finish events; consumers must assemble tool argument fragments.

## Add a provider without changing code

Trusted server configuration `LLM_PROVIDERS_JSON` is a JSON array:

```json
[{"id":"CUSTOM","transport":"openai-compatible","baseUrl":"https://your-provider.example/v1","apiKeyEnv":"CUSTOM_API_KEY","model":"new-model-id","discovery":true,"priority":15,"profiles":{"reasoning-model":{"tokenParameter":"max_completion_tokens","omitTemperature":true,"systemRole":"developer"}}}]
```

The endpoint must support `/chat/completions`. HTTPS is recommended; HTTP is supported for explicitly configured local servers. This configuration selects outbound hosts and credential environment variables: never accept it from an LLM, user prompt, public request or `/models` response. Legacy definitions cannot be overridden. Existing native fallback order is unchanged; new presets follow the legacy chain, or select them explicitly. Missing keys skip compatible providers. Set `NVIDIA_BASE_URL` only for a trusted endpoint.

## New-model recognition and adaptation

Configured compatible providers automatically query `/models` on first use, with a five-minute success cache and a thirty-second failure cache. `discoverModels(provider, true)` refreshes explicitly. Newly listed IDs are recognized without a software release. Discovery failure (unsupported endpoint, timeout, malformed result, auth error) returns the configured model with a clear status; completion remains available. Any compatible model ID is immediately selectable via `model` or provider `modelEnv`, even when discovery is unsupported.

Discovery is not authorization to spend or switch model. It does not silently replace the chosen model. `/models` does not reliably report vision, tools, context size or token-parameter differences: capabilities remain `unknown`, never guessed from names. Per-model profiles adapt token fields, temperature and system roles. Tools can be explicitly disabled for a model. API differences outside Chat Completions need a real transport adapter. This is extensible compatibility, not a claim to support every proprietary protocol automatically.

## Safety and verification

Requests use bounded deadlines, external cancellation, no redirects carrying credentials, and sanitized HTTP errors. SSE parsing handles fragmented UTF-8, CRLF, tool deltas and `[DONE]`; a truncated stream fails explicitly. No other model's answer is appended after output has begun. No vendor error body or key is logged. No retry or extra completion is issued to guess capabilities.

Run `npx vitest run tests/automated/openai-compatible.test.ts`. The tests use an actual loopback HTTP server and the production registry/client/gateway, including HTTP authentication, model discovery, request profiles, tool calls, real SSE, timeout and failure handling. They are protocol tests, not live provider quality tests.

Live NVIDIA verification needs `NVIDIA_API_KEY` securely provisioned in the executing process. NVIDIA trial records inputs/outputs: use only generic/public content. Do not claim live verification from these hermetic tests. No live key is committed and no billing configuration is changed.

## Remaining runtime work

`agentStream` still uses `geminiService.generateAgentResponseStream`, whose prompt compilation, native Google Search/code-execution tools and universal fallback differ from this gateway. This PR deliberately does not replace that route or lose its capabilities. Follow-up: unify structured messages/tool dispatch and stream events behind the registry, translate native tools only where equivalent, and run the full help-cycle/orchestrator E2E on top of PR #62. That runtime is not validated by this PR. Also pending: UI model-picker integration, verified multimodal/provider-specific adapters, and vendor-key regression tests for native providers.
