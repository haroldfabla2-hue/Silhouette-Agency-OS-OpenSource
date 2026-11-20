/**
 * MCP SERVER WRAPPER
 * ═══════════════════════════════════════════════════════════════
 * Exposes Silhouette's internal tools via standard MCP Protocol.
 *
 * This enables external clients (Claude Desktop, Cursor, etc.) to
 * connect to Silhouette and use its tools.
 *
 * 2026-11-05 (R2): tool exposure TEMPORARILY UNAVAILABLE - no tool is
 * verified safe for API-token clients, so zero tools are registered
 * (tools/list empty). Endpoints/auth stay intact; internal paths never
 * use this server. See toolEffects.ts EXTERNALLY_EXPOSED_TOOLS.
 *
 * 2026-11-16 (Unit B, GHSA-345p-7cg4-v4c7): session isolation. The
 * previous wrapper kept ONE McpServer and ONE mutable transport shared
 * by every SSE client: each new connection overwrote this.transport,
 * so POST /mcp/messages was always routed to the most recent client
 * (cross-client message confusion), and disconnects left stale state.
 * The SDK itself rejects a second connect() on one Protocol instance
 * ("use a separate Protocol instance per connection"). Now every SSE
 * connection owns its own McpServer + SSEServerTransport pair, tracked
 * by the SDK-generated sessionId; POSTs are routed strictly by
 * ?sessionId, unknown/expired sessions fail closed with 400, and a
 * connection close disposes exactly its own pair.
 *
 * 2026-11-16 (Unit B review R1): session ownership is bound to the
 * VALIDATED API key identity (ApiKey.id, a uuid — never the
 * duplicate-prone display name). A POST only reaches the SDK handler
 * when the authenticated key is the SAME key that opened the session;
 * any other key — including one with identical name and equal
 * permissions — is rejected 403 before any SDK processing, so a key
 * that learns a victim's sessionId cannot inject into the victim's
 * stream. One key may still own many concurrent sessions.
 *
 * 2026-11-16 (Unit B review R2): transport hardening posture, stated
 * accurately. SSEServerTransport in SDK 1.32.2 DOES support
 * enableDnsRebindingProtection (allowed hosts/origins) and POST request
 * header checks, and both default OFF. Neither is enabled here: the
 * deliberate, pre-existing gap is that this mount validates no Host/Origin
 * and applies no POST header policy. Bearer-token auth reduces
 * ambient-credential ride-along risk (browsers do not attach Authorization
 * cross-origin by themselves) but is NOT a universal no-risk proof: a
 * valid token holder is fully in scope, bounded since R1 to its own
 * sessions by the ownership check. Adding an allowlist or header policy is
 * a separate deliberate unit; none is smuggled into this one.
 *
 * Uses proper SDK types for full type safety - no workarounds.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Application, Request, Response } from "express";

interface McpSession {
    server: McpServer;
    transport: SSEServerTransport;
    /** Stable validated identity of the key that opened this session. */
    keyId: string;
    /** Display name, for logs only — never for authorization. */
    keyName: string;
}

export class MCPWrapper {
    private sessions = new Map<string, McpSession>();

    constructor() {
    }

    /**
     * Builds a fresh protocol server for ONE connection with the exact
     * registered surface. Per-connection instances are required: the SDK
     * allows a single transport per Protocol instance.
     */
    private createServer(): McpServer {
        const server = new McpServer({
            name: "Silhouette Agency OS",
            version: "1.0.0"
        });

        // 1. Tools
        // EXTERNAL EXPOSURE TEMPORARILY DISABLED (2026-11-05, correccion de
        // revision R2): NO registered tool is verified safe for API-token
        // clients (reads disclose user data; external_read enables SSRF/
        // sessions/quota; internal is RCE-equivalent; gated has no reachable
        // approval here), and tools/list must not ANNOUNCE excluded tools.
        // ZERO tools are registered: with no tool ever registered the SDK
        // advertises no tools capability at all, so tools/list and
        // tools/call both fail closed as method-not-found (verified
        // identical on SDK 1.25.1 and 1.32.2; no simulated success). Internal
        // paths (chat, orchestrator, capability) never go through this
        // server. Policy: toolEffects.ts EXTERNALLY_EXPOSED_TOOLS (empty,
        // fail-closed). Endpoints/auth stay intact.

        // 2-3. Resources active_webhooks and toolsets REMOVED (2026-11-05,
        // R2): they disclosed private webhook state and the full tool
        // inventory (payments/vault/shell) to any API-token holder. The
        // external surface must not announce private data nor excluded
        // tools. The prompts resource below serves repo-public prompt
        // files only (repo is public), so it stays.

        // 4. Prompts Resource (Google MCP Pattern)
        // Exposes universal prompts for LLM interactions
        server.resource(
            "prompts",
            "mcp://prompts",
            async (uri) => {
                // Dynamic import to avoid circular deps
                const fs = await import('fs/promises');
                const path = await import('path');

                const promptsDir = path.join(process.cwd(), 'universalprompts');
                const categories: string[] = [];

                try {
                    const dirs = await fs.readdir(promptsDir, { withFileTypes: true });
                    for (const dir of dirs) {
                        if (dir.isDirectory()) {
                            categories.push(dir.name);
                        }
                    }
                } catch {
                    // Directory not found
                }

                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify({
                            available_categories: categories,
                            description: "Universal prompts from top AI models. Use mcp://prompts/{category} for specific prompts."
                        }, null, 2)
                    }]
                };
            }
        );

        return server;
    }

    public async initialize() {
        console.log('[MCP] 🔒 External tools temporarily unavailable: none verified safe for API-token clients (tools/list empty).');
        console.log('[MCP] 🚀 Server initialized: 0 tools exposed (temporarily unavailable for API-token clients), Prompts resource enabled.');
    }

    /**
     * Mounts the MCP server to an Express app
     * Now with API Key authentication
     */
    public async mount(app: Application) {
        // Dynamic import for ESM compatibility
        const { apiKeyService } = await import("../../services/apiKeyService.ts");

        // Authentication middleware for MCP endpoints
        const authenticateMcp = (req: Request, res: Response, next: () => void) => {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.warn('[MCP] ⚠️ Connection attempt without authentication');
                res.status(401).json({ error: 'Authentication required. Use Bearer <api_key>' });
                return;
            }

            const apiKey = authHeader.substring(7); // Remove 'Bearer '
            const keyData = apiKeyService.validateKey(apiKey);

            if (!keyData) {
                console.warn('[MCP] ⚠️ Invalid or expired API key');
                res.status(403).json({ error: 'Invalid or expired API key' });
                return;
            }

            // Attach key data to request for permission checking
            (req as any).apiKey = keyData;
            console.log(`[MCP] 🔐 Authenticated: ${keyData.name}`);
            next();
        };

        // SSE Endpoint for connection (requires authentication)
        app.get("/mcp/sse", authenticateMcp, async (req: Request, res: Response) => {
            const keyData = (req as any).apiKey;

            // Check tools:read permission
            if (!apiKeyService.hasPermission(keyData, 'tools:read')) {
                res.status(403).json({ error: 'Missing permission: tools:read' });
                return;
            }

            console.log(`[MCP] 🔗 SSE Connection from ${keyData.name}`);

            // Per-connection server+transport (session isolation; see header).
            const server = this.createServer();
            const transport = new SSEServerTransport("/mcp/messages", res);
            const sessionId = transport.sessionId;

            transport.onclose = () => {
                // Dispose exactly this connection's pair; never touches others.
                // The transport is already closed (that is why onclose fired)
                // and the SDK's own wiring runs Protocol._onclose, so the
                // session's McpServer must NOT be close()d here: server.close()
                // would re-enter transport.close(), re-fire this handler, and
                // recurse to stack exhaustion (observed in the fixture). With
                // the map entry gone, the closed pair is unreferenced.
                if (this.sessions.delete(sessionId)) {
                    console.log(`[MCP] 🔌 SSE session closed for ${keyData.name} (${sessionId})`);
                }
            };

            this.sessions.set(sessionId, { server, transport, keyId: keyData.id, keyName: keyData.name });
            try {
                await server.connect(transport);
            } catch (err) {
                // Failed connect must not leak the half-open pair or a
                // hanging response. Both closes are awaited (idempotent by
                // SDK contract); the onclose path above may also run and is
                // equally idempotent (Map delete + guarded close).
                this.sessions.delete(sessionId);
                await server.close().catch(() => undefined);
                await transport.close().catch(() => undefined);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'MCP session initialization failed' });
                } else if (!res.writableEnded) {
                    res.end();
                }
                console.warn(`[MCP] ⚠️ SSE session initialization failed for ${keyData.name}:`, err);
            }
        });

        // POST Endpoint for messages (requires authentication)
        app.post("/mcp/messages", authenticateMcp, async (req: Request, res: Response) => {
            const keyData = (req as any).apiKey;

            // Check tools:execute permission for tool calls
            if (!apiKeyService.hasPermission(keyData, 'tools:execute')) {
                res.status(403).json({ error: 'Missing permission: tools:execute' });
                return;
            }

            // Strict per-session routing: a POST only ever reaches the
            // transport that owns its ?sessionId; anything else fails closed.
            const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
            const session = sessionId ? this.sessions.get(sessionId) : undefined;
            if (!session) {
                res.status(400).send("Unknown or expired MCP session");
                return;
            }

            // Ownership check BEFORE any SDK processing: only the same
            // validated key (stable ApiKey.id) that opened the session may
            // post to it. A different key — even with the same display name
            // and equal permissions — cannot inject into another session.
            if (session.keyId !== keyData.id) {
                console.warn(`[MCP] ⛔ Session ownership mismatch: key "${keyData.name}" (${keyData.id}) tried to post to session owned by "${session.keyName}" (${session.keyId})`);
                res.status(403).json({ error: 'API key does not own this MCP session' });
                return;
            }

            await session.transport.handlePostMessage(req, res);
        });

        console.log("[MCP] 🌐 Mounted at /mcp/sse (with API key authentication)");
    }

    /**
     * Test/inspection hooks: live session cardinality and ids. Read-only;
     * no internal references escape.
     */
    public get activeSessionCount(): number {
        return this.sessions.size;
    }

    public get activeSessionIds(): string[] {
        return [...this.sessions.keys()];
    }
}

export const mcpWrapper = new MCPWrapper();
