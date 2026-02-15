/**
 * MCP SERVER WRAPPER
 * ═══════════════════════════════════════════════════════════════
 * Exposes Silhouette's internal tools via standard MCP Protocol.
 * 
 * This enables external clients (Claude Desktop, Cursor, etc.) to
 * connect to Silhouette and use its tools.
 * 
 * Uses proper SDK types for full type safety - no workarounds.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { TextContent, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolRegistry } from "../../services/tools/toolRegistry";
import { toolExecutor } from "../../services/tools/toolExecutor";
import { webhookManager } from "../../services/webhookManager";
import { z } from "zod";
import type { Application, Request, Response } from "express";

/**
 * Helper to create a properly typed TextContent object
 */
function createTextContent(text: string): TextContent {
    return {
        type: "text",
        text
    };
}

/**
 * Helper to create a properly typed CallToolResult
 */
function createToolResult(text: string, isError: boolean = false): CallToolResult {
    return {
        content: [createTextContent(text)],
        isError
    };
}

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
        const tools = toolRegistry.getAllTools();

        // 1. Register Tools
        for (const tool of tools) {
            const paramsSchema = this.mapSchemaToZod(tool.parameters);
            this.server.tool(
                tool.name,
                tool.description || "No description provided",
                paramsSchema,
                async (args: Record<string, unknown>) => {
                    console.log(`[MCP] 📞 External Client calling tool: ${tool.name}`);
                    try {
                        // Special handling for some tools if needed, otherwise generic execution
                        const result = await toolExecutor.execute(tool.name, args);

                        // Ensure result is formatted for MCP (CallToolResult)
                        // If result is already a CallToolResult (has explicit content/isError), use it
                        if (result && typeof result === 'object' && 'content' in result && Array.isArray(result.content)) {
                            return result;
                        }

                        // Otherwise wrap it
                        const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                        return {
                            content: [{ type: "text", text: resultText }],
                            isError: false
                        };
                    } catch (error: any) {
                        console.error(`[MCP] ❌ Tool execution failed: ${error.message}`);
                        return {
                            content: [{ type: "text", text: `Error: ${error.message}` }],
                            isError: true
                        };
                    }
                }
            );
        }

        // 2. Register Resources (Webhooks & System State)
        this.server.resource(
            "active_webhooks",
            "webhook://list",
            async (uri) => {
                const webhooks = webhookManager.getActiveWebhooks();
                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify(webhooks, null, 2)
                    }]
                };
            }
        );

        // 3. [NEW] Register Toolsets Resource (Google MCP Pattern)
        // Allows clients to load grouped tools by category
        this.server.resource(
            "toolsets",
            "mcp://toolsets",
            async (uri) => {
                const allTools = toolRegistry.getAllTools();

                // Group tools by category/prefix
                const toolsets: Record<string, string[]> = {
                    media: allTools.filter(t =>
                        t.name.includes('image') || t.name.includes('video') || t.name.includes('audio')
                    ).map(t => t.name),
                    research: allTools.filter(t =>
                        t.name.includes('search') || t.name.includes('web') || t.name.includes('arxiv')
                    ).map(t => t.name),
                    code: allTools.filter(t =>
                        t.name.includes('code') || t.name.includes('file') || t.name.includes('execute')
                    ).map(t => t.name),
                    memory: allTools.filter(t =>
                        t.name.includes('memory') || t.name.includes('store') || t.name.includes('recall')
                    ).map(t => t.name),
                    all: allTools.map(t => t.name)
                };

                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify(toolsets, null, 2)
                    }]
                };
            }
        );

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
     * Maps internal FunctionDeclarationSchema to Zod raw shape
     * Returns the raw shape object that the MCP SDK expects
     */
    private mapSchemaToZod(schema: unknown): z.ZodRawShape {
        const shape: z.ZodRawShape = {};

        const schemaObj = schema as { properties?: Record<string, { type?: string; description?: string }> };

        if (schemaObj?.properties) {
            for (const [key, prop] of Object.entries(schemaObj.properties)) {
                // Determine Zod type based on schema type
                let zodType: z.ZodTypeAny;

                switch (prop.type?.toUpperCase()) {
                    case 'STRING':
                        zodType = z.string();
                        break;
                    case 'NUMBER':
                        zodType = z.number();
                        break;
                    case 'BOOLEAN':
                        zodType = z.boolean();
                        break;
                    case 'ARRAY':
                        zodType = z.array(z.unknown());
                        break;
                    case 'OBJECT':
                        zodType = z.record(z.unknown());
                        break;
                    default:
                        zodType = z.unknown();
                }

                if (prop.description) {
                    zodType = zodType.describe(prop.description);
                }

                // Make all parameters optional for flexibility
                // Required validation should happen in toolExecutor
                shape[key] = zodType.optional();
            }
        }

        return shape;
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
