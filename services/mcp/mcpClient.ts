/**
 * MCP CLIENT - Silhouette Consumes External Services
 * ═══════════════════════════════════════════════════════════════
 * Allows Silhouette to connect to external MCP servers and use
 * THEIR tools (Instagram, Spotify, LinkedIn, etc.)
 * 
 * This is the INVERSE of the existing mcpServer.ts which exposes
 * Silhouette's tools to external clients.
 * 
 * Architecture:
 * - Silhouette → MCPClient → External MCP Server → External Service
 */

import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// ==================== INTERFACES ====================

export interface MCPServerConfig {
    name: string;
    url: string;
    apiKey?: string;
    description?: string;
    autoConnect?: boolean;
}

export interface ExternalTool {
    serverName: string;
    name: string;
    description: string;
    inputSchema: any;
}

export interface MCPServerStatus {
    name: string;
    url: string;
    connected: boolean;
    toolCount: number;
    lastPing: number;
    error?: string;
}

// ==================== MCP CLIENT ====================

class MCPClient {
    private static instance: MCPClient;

    // Connected servers
    private servers: Map<string, MCPServerConfig> = new Map();
    private serverStatus: Map<string, MCPServerStatus> = new Map();

    // Discovered tools from external servers
    private externalTools: Map<string, ExternalTool[]> = new Map();

    private constructor() {
        console.log('[MCPClient] 🔌 MCP Client initialized');
    }

    public static getInstance(): MCPClient {
        if (!MCPClient.instance) {
            MCPClient.instance = new MCPClient();
        }
        return MCPClient.instance;
    }

    // ==================== SERVER MANAGEMENT ====================

    /**
     * Register an external MCP server configuration
     */
    public registerServer(config: MCPServerConfig): void {
        this.servers.set(config.name, config);
        this.serverStatus.set(config.name, {
            name: config.name,
            url: config.url,
            connected: false,
            toolCount: 0,
            lastPing: 0
        });
        console.log(`[MCPClient] 📝 Registered server: ${config.name} (${config.url})`);

        if (config.autoConnect) {
            this.connect(config.name).catch(err =>
                console.warn(`[MCPClient] Auto-connect failed for ${config.name}:`, err.message)
            );
        }
    }

    /**
     * Connect to an MCP server and discover its tools
     */
    public async connect(serverName: string): Promise<boolean> {
        const config = this.servers.get(serverName);
        if (!config) {
            console.error(`[MCPClient] Server not found: ${serverName}`);
            return false;
        }

        console.log(`[MCPClient] 🔗 Connecting to ${serverName} at ${config.url}...`);

        try {
            // Attempt to connect via SSE (Server-Sent Events)
            const response = await fetch(`${config.url}/sse`, {
                method: 'GET',
                headers: config.apiKey ? {
                    'Authorization': `Bearer ${config.apiKey}`
                } : {},
                signal: AbortSignal.timeout(5000)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Discover tools
            const tools = await this.discoverTools(serverName);

            // Update status
            this.serverStatus.set(serverName, {
                name: serverName,
                url: config.url,
                connected: true,
                toolCount: tools.length,
                lastPing: Date.now()
            });

            // Emit connection event
            systemBus.emit(SystemProtocol.CONNECTION_RESTORED, {
                source: 'MCPClient',
                serverName,
                toolCount: tools.length
            }, 'MCPClient');

            console.log(`[MCPClient] ✅ Connected to ${serverName} - Discovered ${tools.length} tools`);
            return true;

        } catch (error: any) {
            this.serverStatus.set(serverName, {
                name: serverName,
                url: config.url,
                connected: false,
                toolCount: 0,
                lastPing: Date.now(),
                error: error.message
            });

            systemBus.emit(SystemProtocol.CONNECTION_LOST, {
                source: 'MCPClient',
                serverName,
                error: error.message
            }, 'MCPClient');

            console.error(`[MCPClient] ❌ Failed to connect to ${serverName}:`, error.message);
            return false;
        }
    }

    /**
     * Disconnect from an MCP server
     */
    public disconnect(serverName: string): void {
        const status = this.serverStatus.get(serverName);
        if (status) {
            status.connected = false;
            this.externalTools.delete(serverName);
            console.log(`[MCPClient] 🔌 Disconnected from ${serverName}`);
        }
    }

    // ==================== TOOL DISCOVERY ====================

    /**
     * Discover tools available on a connected MCP server
     */
    public async discoverTools(serverName: string): Promise<ExternalTool[]> {
        const config = this.servers.get(serverName);
        if (!config) return [];

        try {
            const response = await fetch(`${config.url}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: `discover_${Date.now()}`,
                    method: 'tools/list',
                    params: {}
                }),
                signal: AbortSignal.timeout(10000)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            const tools: ExternalTool[] = (result.result?.tools || []).map((t: any) => ({
                serverName,
                name: t.name,
                description: t.description || 'No description',
                inputSchema: t.inputSchema || {}
            }));

            this.externalTools.set(serverName, tools);
            return tools;

        } catch (error: any) {
            console.warn(`[MCPClient] Tool discovery failed for ${serverName}:`, error.message);
            return [];
        }
    }

    // ==================== TOOL EXECUTION ====================

    /**
     * Execute a tool on an external MCP server
     */
    public async executeTool(
        serverName: string,
        toolName: string,
        args: any
    ): Promise<any> {
        const config = this.servers.get(serverName);
        if (!config) {
            return { error: `Server not found: ${serverName}` };
        }

        const status = this.serverStatus.get(serverName);
        if (!status?.connected) {
            // Try to reconnect
            const connected = await this.connect(serverName);
            if (!connected) {
                return { error: `Cannot connect to ${serverName}` };
            }
        }

        console.log(`[MCPClient] 🔧 Executing ${toolName} on ${serverName}...`);

        try {
            const response = await fetch(`${config.url}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: `exec_${Date.now()}`,
                    method: 'tools/call',
                    params: {
                        name: toolName,
                        arguments: args
                    }
                }),
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (result.error) {
                return { error: result.error.message || 'Unknown error' };
            }

            return result.result;

        } catch (error: any) {
            console.error(`[MCPClient] Tool execution failed:`, error.message);
            return { error: error.message };
        }
    }

    // ==================== GETTERS ====================

    /**
     * Get all registered server configurations
     */
    public getRegisteredServers(): MCPServerConfig[] {
        return Array.from(this.servers.values());
    }

    /**
     * Get status of all servers
     */
    public getServerStatuses(): MCPServerStatus[] {
        return Array.from(this.serverStatus.values());
    }

    /**
     * Get all discovered external tools
     */
    public getAllExternalTools(): ExternalTool[] {
        const allTools: ExternalTool[] = [];
        for (const tools of this.externalTools.values()) {
            allTools.push(...tools);
        }
        return allTools;
    }

    /**
     * Get tools from a specific server
     */
    public getToolsFromServer(serverName: string): ExternalTool[] {
        return this.externalTools.get(serverName) || [];
    }

    /**
     * Check if a specific tool is available
     */
    public hasExternalTool(toolName: string): { available: boolean; serverName?: string } {
        for (const [serverName, tools] of this.externalTools) {
            if (tools.some(t => t.name === toolName)) {
                return { available: true, serverName };
            }
        }
        return { available: false };
    }

    /**
     * Get formatted list of external tools for PromptCompiler
     */
    public getExternalToolsSummary(): string {
        const tools = this.getAllExternalTools();
        if (tools.length === 0) return '';

        return `[EXTERNAL MCP TOOLS (${tools.length} available)]\n` +
            tools.map(t => `- ${t.serverName}/${t.name}: ${t.description}`).join('\n');
    }
}

// ==================== PRE-CONFIGURED SERVERS ====================

// These can be loaded from config or environment
const KNOWN_MCP_SERVERS: MCPServerConfig[] = [
    // Placeholder configurations - user can add their own
    // {
    //     name: 'spotify',
    //     url: 'http://localhost:3100/mcp',
    //     description: 'Spotify music control',
    //     autoConnect: false
    // },
    // {
    //     name: 'github',
    //     url: 'http://localhost:3101/mcp',
    //     description: 'GitHub repository management',
    //     autoConnect: false
    // }
];

// Initialize singleton and register known servers
export const mcpClient = MCPClient.getInstance();

// Register known servers at module load
KNOWN_MCP_SERVERS.forEach(server => {
    mcpClient.registerServer(server);
});
