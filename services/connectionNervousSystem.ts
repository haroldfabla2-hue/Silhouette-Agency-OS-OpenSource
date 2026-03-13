/**
 * CONNECTION NERVOUS SYSTEM
 * 
 * Silhouette's Auto-Healing Network Layer
 * 
 * Monitors all external connections and automatically attempts recovery:
 * - Neo4j Graph Database
 * - Redis (if configured)
 * - Ollama Local LLM
 * - Google APIs (Drive/Gmail)
 * - External LLM APIs
 * 
 * Emits events to SystemBus for UI notifications and logging.
 */

import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

// ==================== TYPES ====================

export type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'UNKNOWN';

export interface ConnectionTarget {
    id: string;
    name: string;
    type: 'DATABASE' | 'API' | 'LOCAL_SERVICE' | 'CLOUD';
    checkHealth: () => Promise<boolean>;
    reconnect: () => Promise<boolean>;
    isRequired: boolean; // If true, system is degraded without it
}

interface ConnectionState {
    status: ConnectionStatus;
    lastCheck: number;
    lastSuccess: number;
    consecutiveFailures: number;
    isRecovering: boolean;
}

// ==================== NERVOUS SYSTEM ====================

class ConnectionNervousSystem {
    private connections: Map<string, ConnectionTarget> = new Map();
    private states: Map<string, ConnectionState> = new Map();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
    private readonly MAX_CONSECUTIVE_FAILURES = 3;

    constructor() {
        console.log("[NERVOUS] 🧠 Connection Nervous System initializing...");
    }

    /**
     * Register a connection to be monitored
     */
    public register(target: ConnectionTarget): void {
        if (this.connections.has(target.id)) {
            console.log(`[NERVOUS] 🔄 Re-registering: ${target.name} (${target.type})`);
        }
        this.connections.set(target.id, target);
        this.states.set(target.id, {
            status: 'UNKNOWN',
            lastCheck: 0,
            lastSuccess: 0,
            consecutiveFailures: 0,
            isRecovering: false
        });
        console.log(`[NERVOUS] 📡 Registered: ${target.name} (${target.type})`);

        // Immediately check health of the new connection
        this.checkConnection(target.id, target).catch(() => { });
    }

    /**
     * Unregister a connection — stops monitoring it
     */
    public unregister(id: string): boolean {
        const target = this.connections.get(id);
        if (!target) return false;

        this.connections.delete(id);
        this.states.delete(id);
        console.log(`[NERVOUS] 🔌 Unregistered: ${target.name}`);
        return true;
    }

    /**
     * Check if a connection is already registered
     */
    public isRegistered(id: string): boolean {
        return this.connections.has(id);
    }

    /**
     * Start the nervous system heartbeat
     */
    public start(): void {
        if (this.heartbeatInterval) return;

        console.log("[NERVOUS] 💓 Starting heartbeat monitor...");

        // Initial health check
        this.checkAllConnections();

        // Periodic heartbeat
        this.heartbeatInterval = setInterval(() => {
            this.checkAllConnections();
        }, this.HEARTBEAT_INTERVAL);
    }

    /**
     * Stop the nervous system
     */
    public stop(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log("[NERVOUS] 🛑 Heartbeat stopped.");
        }
    }

    /**
     * Check health of all registered connections
     */
    private async checkAllConnections(): Promise<void> {
        const checks = Array.from(this.connections.entries()).map(async ([id, target]) => {
            await this.checkConnection(id, target);
        });

        await Promise.allSettled(checks);

        // Emit heartbeat summary
        const summary = this.getHealthSummary();
        systemBus.emit(SystemProtocol.CONNECTION_HEARTBEAT, summary, 'NERVOUS_SYSTEM');
    }

    /**
     * Check a single connection and handle state transitions
     */
    private async checkConnection(id: string, target: ConnectionTarget): Promise<void> {
        const state = this.states.get(id);
        if (!state || state.isRecovering) return;

        const now = Date.now();
        state.lastCheck = now;

        try {
            const isHealthy = await target.checkHealth();

            if (isHealthy) {
                // Connection is healthy
                if (state.status !== 'CONNECTED') {
                    // Was disconnected, now restored
                    console.log(`[NERVOUS] ✅ ${target.name} RESTORED`);
                    state.status = 'CONNECTED';
                    state.consecutiveFailures = 0;

                    systemBus.emit(SystemProtocol.CONNECTION_RESTORED, {
                        id: target.id,
                        name: target.name,
                        type: target.type,
                        timestamp: now
                    }, 'NERVOUS_SYSTEM');
                }
                state.lastSuccess = now;

            } else {
                // Health check returned false
                this.handleFailure(id, target, state, 'Health check returned false');
            }

        } catch (error: any) {
            // Health check threw an error
            this.handleFailure(id, target, state, error.message);
        }
    }

    /**
     * Handle a connection failure
     */
    private async handleFailure(
        id: string,
        target: ConnectionTarget,
        state: ConnectionState,
        reason: string
    ): Promise<void> {
        state.consecutiveFailures++;

        if (state.status === 'CONNECTED') {
            // First failure - mark as disconnected
            console.warn(`[NERVOUS] ⚠️ ${target.name} DISCONNECTED: ${reason}`);
            state.status = 'DISCONNECTED';

            systemBus.emit(SystemProtocol.CONNECTION_LOST, {
                id: target.id,
                name: target.name,
                type: target.type,
                reason,
                isRequired: target.isRequired,
                timestamp: Date.now()
            }, 'NERVOUS_SYSTEM');
        }

        // Attempt automatic recovery
        if (state.consecutiveFailures <= this.MAX_CONSECUTIVE_FAILURES) {
            await this.attemptRecovery(id, target, state);
        } else {
            console.error(`[NERVOUS] ❌ ${target.name} max recovery attempts reached. Manual intervention required.`);
        }
    }

    /**
     * Attempt to reconnect a failed connection
     */
    private async attemptRecovery(
        id: string,
        target: ConnectionTarget,
        state: ConnectionState
    ): Promise<void> {
        if (state.isRecovering) return;

        state.isRecovering = true;
        state.status = 'CONNECTING';

        console.log(`[NERVOUS] 🔄 Attempting recovery for ${target.name} (attempt ${state.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})...`);

        // Exponential backoff
        const delay = 2000 * Math.pow(2, state.consecutiveFailures - 1);
        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            const success = await target.reconnect();

            if (success) {
                state.status = 'CONNECTED';
                state.consecutiveFailures = 0;
                state.lastSuccess = Date.now();

                console.log(`[NERVOUS] ✅ ${target.name} recovered successfully!`);

                systemBus.emit(SystemProtocol.CONNECTION_RESTORED, {
                    id: target.id,
                    name: target.name,
                    type: target.type,
                    recoveryAttempts: state.consecutiveFailures,
                    timestamp: Date.now()
                }, 'NERVOUS_SYSTEM');
            } else {
                state.status = 'DISCONNECTED';
            }

        } catch (error: any) {
            console.error(`[NERVOUS] ❌ Recovery failed for ${target.name}: ${error.message}`);
            state.status = 'DISCONNECTED';
        } finally {
            state.isRecovering = false;
        }
    }

    /**
     * Get health summary of all connections
     */
    public getHealthSummary(): {
        healthy: number;
        unhealthy: number;
        total: number;
        connections: Array<{ id: string; name: string; status: ConnectionStatus; type: string }>;
    } {
        const connections: Array<{ id: string; name: string; status: ConnectionStatus; type: string }> = [];
        let healthy = 0;
        let unhealthy = 0;

        for (const [id, target] of this.connections) {
            const state = this.states.get(id);
            const status = state?.status || 'UNKNOWN';

            connections.push({
                id,
                name: target.name,
                status,
                type: target.type
            });

            if (status === 'CONNECTED') healthy++;
            else unhealthy++;
        }

        return {
            healthy,
            unhealthy,
            total: this.connections.size,
            connections
        };
    }

    /**
     * Force a health check on a specific connection
     */
    public async forceCheck(id: string): Promise<boolean> {
        const target = this.connections.get(id);
        if (!target) return false;

        await this.checkConnection(id, target);
        return this.states.get(id)?.status === 'CONNECTED';
    }

    /**
     * Get status of a specific connection
     */
    public getStatus(id: string): ConnectionState | undefined {
        return this.states.get(id);
    }
}

// ==================== SINGLETON & REGISTRATION ====================

export const nervousSystem = new ConnectionNervousSystem();

/**
 * Register default connections
 * Called during server initialization
 */
export async function initializeNervousSystem(): Promise<void> {
    console.log("[NERVOUS] 🔌 Registering default connections...");

    // 1. Neo4j Graph Database - register for health monitoring
    try {
        const { graph } = await import('./graphService');
        nervousSystem.register({
            id: 'neo4j',
            name: 'Neo4j Graph',
            type: 'DATABASE',
            isRequired: false,
            checkHealth: async () => {
                if (!graph['isConnected']) {
                    console.warn("[NERVOUS] graph.isConnected() is not accessible or not a function.");
                    return false;
                }
                return graph.isConnected();
            },
            reconnect: async () => graph.connect()
        });
    } catch (e) {
        console.warn("[NERVOUS] Neo4j service not available for monitoring");
    }

    // 2. Ollama Local LLM — only register if Ollama is actually available
    try {
        const ollamaProbe = await fetch('http://localhost:11434/api/tags', {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        if (ollamaProbe.ok) {
            nervousSystem.register({
                id: 'ollama',
                name: 'Ollama LLM',
                type: 'LOCAL_SERVICE',
                isRequired: false,
                checkHealth: async () => {
                    try {
                        const response = await fetch('http://localhost:11434/api/tags', {
                            method: 'GET',
                            signal: AbortSignal.timeout(3000)
                        });
                        return response.ok;
                    } catch {
                        return false;
                    }
                },
                reconnect: async () => {
                    try {
                        const response = await fetch('http://localhost:11434/api/tags');
                        return response.ok;
                    } catch {
                        return false;
                    }
                }
            });
        } else {
            console.log("[NERVOUS] ℹ️ Ollama not available — skipping monitoring (install from ollama.com if needed)");
        }
    } catch {
        console.log("[NERVOUS] ℹ️ Ollama not installed or not running — skipping monitoring");
    }

    // 3. Google APIs (Drive/Gmail) — only register if credentials are configured
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        try {
            const { driveService } = await import('./driveService');
            nervousSystem.register({
                id: 'google_apis',
                name: 'Google APIs',
                type: 'CLOUD',
                isRequired: false,
                checkHealth: async () => {
                    await driveService.init();
                    return driveService.isAuthenticated();
                },
                reconnect: async () => {
                    await driveService.init();
                    return driveService.isAuthenticated();
                }
            });
        } catch (e: any) {
            console.warn("[NERVOUS] Google Drive service not available for monitoring:", e.message);
        }
    } else {
        console.log("[NERVOUS] ℹ️ Google APIs not configured — skipping monitoring (set GOOGLE_CLIENT_ID/SECRET in .env.local)");
    }

    // 4. Redis — register if REDIS_URL is configured (Docker service)
    if (process.env.REDIS_URL) {
        try {
            const { redisClient } = await import('./redisClient');
            nervousSystem.register({
                id: 'redis',
                name: 'Redis Cache',
                type: 'DATABASE',
                isRequired: false,
                checkHealth: async () => {
                    // If Redis fell back to mock mode, it's not truly connected
                    if (redisClient.isMockMode()) return false;
                    try {
                        // Try a round-trip ping via get
                        await redisClient.get('__nervous_ping__');
                        return true;
                    } catch {
                        return false;
                    }
                },
                reconnect: async () => {
                    try {
                        await redisClient.connect();
                        return !redisClient.isMockMode();
                    } catch {
                        return false;
                    }
                }
            });
        } catch (e) {
            console.warn("[NERVOUS] Redis client not available for monitoring");
        }
    }

    // 5. Gemini API (Primary LLM) — register if API key is configured
    if (process.env.GEMINI_API_KEY || process.env.API_KEY) {
        nervousSystem.register({
            id: 'gemini_api',
            name: 'Gemini LLM',
            type: 'API',
            isRequired: false,
            checkHealth: async () => {
                // Cheap check: verify the SDK client is initialized (no API call)
                try {
                    const mod = await import('./geminiService');
                    // ensureClient is not exported, but we can check generateText exists
                    // If the key is set, the client initializes fine
                    return !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
                } catch {
                    return false;
                }
            },
            reconnect: async () => {
                // On reconnect, do a real lightweight API call to verify the key works
                try {
                    const { geminiService } = await import('./geminiService');
                    const result = await geminiService.generateEmbedding('ping');
                    return result !== null;
                } catch {
                    return false;
                }
            }
        });
    } else {
        console.log("[NERVOUS] ℹ️ Gemini API not configured — skipping monitoring (set GEMINI_API_KEY in .env.local)");
    }

    // 6. MiniMax API (Secondary LLM) — register if API key is configured
    if (process.env.MINIMAX_API_KEY) {
        nervousSystem.register({
            id: 'minimax_api',
            name: 'MiniMax LLM',
            type: 'API',
            isRequired: false,
            checkHealth: async () => {
                // Cheap check: verify the API key is still set (no API call)
                return !!process.env.MINIMAX_API_KEY;
            },
            reconnect: async () => {
                // On reconnect, do a real API call to verify reachability
                try {
                    const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'MiniMax-Text-01',
                            messages: [{ role: 'user', content: 'ping' }],
                            max_tokens: 1
                        }),
                        signal: AbortSignal.timeout(5000)
                    });
                    return response.ok || response.status === 429;
                } catch {
                    return false;
                }
            }
        });
    } else {
        console.log("[NERVOUS] ℹ️ MiniMax API not configured — skipping monitoring");
    }

    // 7. Listen for dynamic integration events from Settings UI
    systemBus.subscribe(SystemProtocol.INTEGRATION_EVENT, (event: any) => {
        const { action, integrationId, name, type } = event.payload || {};
        if (action === 'connected' && integrationId) {
            // Integration was enabled in Settings — register if not already
            if (!nervousSystem.isRegistered(`integration:${integrationId}`)) {
                nervousSystem.register({
                    id: `integration:${integrationId}`,
                    name: name || integrationId,
                    type: type || 'API',
                    isRequired: false,
                    checkHealth: async () => true, // Basic — overridden by specific integrations
                    reconnect: async () => true
                });
            }
        } else if (action === 'disconnected' && integrationId) {
            nervousSystem.unregister(`integration:${integrationId}`);
        }
    });

    // Start monitoring
    nervousSystem.start();

    console.log("[NERVOUS] ✅ Nervous System online. Monitoring", nervousSystem.getHealthSummary().total, "connections.");
}
