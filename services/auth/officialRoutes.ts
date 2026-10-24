/**
 * [auth-connections] Registry of OFFICIAL connection routes only, each with
 * its vendor documentation URL. No ported client IDs, no reused CLI tokens,
 * no vendor-restricted flows. Real login stays PENDING the owner's accounts/
 * plans decision and an explicit authorization per connection.
 */
import type { AuthMethod } from './accountStore';

export interface OfficialRoute {
    routeId: string;
    providerId: string;
    method: AuthMethod;
    /** Vendor documentation that establishes the route. */
    officialSource: string;
    /** What the owner must supply for the route to become usable. */
    requires: string;
    status: 'documented-official' | 'blocked-vendor-oauth';
    notes: string;
}

export const officialRoutes: OfficialRoute[] = [
    {
        routeId: 'codex-cli-authjson',
        providerId: 'OPENAI_CODEX',
        method: 'command',
        officialSource: 'https://developers.openai.com/codex/auth/ci-cd-auth/',
        requires: 'Owner ChatGPT/Codex account; run official `codex` CLI login once, then register the produced auth.json path.',
        status: 'documented-official',
        notes: 'OpenAI documents CI/CD auth via the official CLI auth.json. We reference the file; we never copy tokens into Silhouette stores.',
    },
    {
        routeId: 'claude-setup-token',
        providerId: 'ANTHROPIC_CLAUDE',
        method: 'command',
        officialSource: 'https://code.claude.com/docs/en/authentication',
        requires: 'Owner Claude account; official `claude setup-token` flow.',
        status: 'documented-official',
        notes: 'Anthropic documents setup-token for Claude Code CI. Third-party reuse of Pro/Max subscription OAuth is a third-party CLAIM (OpenCode docs), not vendor-verified: not implemented.',
    },
    {
        routeId: 'copilot-official-sdk',
        providerId: 'GITHUB_COPILOT',
        method: 'command',
        officialSource: 'https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate',
        requires: 'Owner GitHub Copilot subscription; official Copilot CLI/SDK authentication.',
        status: 'documented-official',
        notes: 'Use the official SDK/CLI auth; do not reuse the Copilot CLI OAuth client registration.',
    },
    {
        routeId: 'gemini-api-key',
        providerId: 'GEMINI',
        method: 'api-key',
        officialSource: 'https://geminicli.com/docs/resources/tos-privacy/',
        requires: 'GEMINI_API_KEY (existing).',
        status: 'blocked-vendor-oauth',
        notes: 'Gemini CLI OAuth reuse by third parties is restricted in the ecosystem ToS doc: Silhouette keeps API-key only for Google.',
    },
    {
        routeId: 'openai-compatible-key',
        providerId: 'GENERIC_OPENAI_COMPATIBLE',
        method: 'api-key',
        officialSource: 'n/a (provider-agnostic env var route)',
        requires: 'Provider API key in the env var named by the provider definition.',
        status: 'documented-official',
        notes: 'Existing route for Groq/OpenRouter/NVIDIA/Ollama Cloud via apiKeyEnv.',
    },
];

export function routesFor(providerId: string): OfficialRoute[] {
    return officialRoutes.filter(r => r.providerId === providerId);
}
