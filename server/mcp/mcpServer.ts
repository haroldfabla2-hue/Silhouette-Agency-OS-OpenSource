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
 * (tools/list empty). Endpoints and auth remain; internal paths never
 * use this server. See toolEffects.ts EXTERNALLY_EXPOSED_TOOLS.
 * 
 * Uses proper SDK types for full type safety - no workarounds.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Application, Request, Response } from "express";

export class MCPWrapper {
    private server: McpServer;
    private transport: SSEServerTransport | null = null;

    constructor() {
        this.server = new McpServer({
            name: "Silhouette Agency OS",
            version: "1.0.0"
        });
    }

    public async initialize() {
        // 1. Register Tools
        // EXTERNAL EXPOSURE TEMPORARILY DISABLED (2026-11-05, correccion de
        // revision R2): NO registered tool is verified safe for API-token
        // clients (reads disclose user data; external_read enables SSRF/
        // sessions/quota; internal is RCE-equivalent; gated has no reachable
        // approval here), and tools/list must not ANNOUNCE excluded tools.
        // ZERO tools are registered: tools/list answers empty (honest),
        // tools/call fails as unknown tool (no simulated success). Internal
        // paths (chat, orchestrator, capability) never go through this
        // server. Policy: toolEffects.ts EXTERNALLY_EXPOSED_TOOLS (empty,
        // fail-closed). Endpoints/auth stay intact.
        console.log('[MCP] 🔒 External tools temporarily unavailable: none verified safe for API-token clients (tools/list empty).');

        // 2-3. Resources active_webhooks and toolsets REMOVED (2026-11-05,
        // R2): they disclosed private webhook state and the full tool
        // inventory (payments/vault/shell) to any API-token holder. The
        // external surface must not announce private data nor excluded
        // tools. The prompts resource below serves repo-public prompt
        // files only (repo is public), so it stays.

        // 4. [NEW] Register Prompts Resource (Google MCP Pattern)
        // Exposes universal prompts for LLM interactions
        this.server.resource(
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

        console.log(`[MCP] 🚀 Server initialized with ${tools.length} tools, Toolsets, Prompts, and Resources enabled.`);
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
            this.transport = new SSEServerTransport("/mcp/messages", res);
            await this.server.connect(this.transport);
        });

        // POST Endpoint for messages (requires authentication)
        app.post("/mcp/messages", authenticateMcp, async (req: Request, res: Response) => {
            const keyData = (req as any).apiKey;

            // Check tools:execute permission for tool calls
            if (!apiKeyService.hasPermission(keyData, 'tools:execute')) {
                res.status(403).json({ error: 'Missing permission: tools:execute' });
                return;
            }

            if (this.transport) {
                await this.transport.handlePostMessage(req, res);
            } else {
                res.status(400).send("Transport not initialized");
            }
        });

        console.log("[MCP] 🌐 Mounted at /mcp/sse (with API key authentication)");
    }
}

export const mcpWrapper = new MCPWrapper();
