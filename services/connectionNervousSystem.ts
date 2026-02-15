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
        this.connections.set(target.id, target);
        this.states.set(target.id, {
            status: 'UNKNOWN',
            lastCheck: 0,
            lastSuccess: 0,
            consecutiveFailures: 0,
            isRecovering: false
        });
        console.log(`[NERVOUS] 📡 Registered: ${target.name} (${target.type})`);
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

    // Neo4j Graph Database - Removed Initial Registration (Now Handled by GraphService on First Connect)

    // 2. Ollama Local LLM
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
            // Ollama is external, we can only check if it's back
            try {
                const response = await fetch('http://localhost:11434/api/tags');
                return response.ok;
            } catch {
                return false;
            }
        }
    });

    // 3. Google APIs (Drive/Gmail)
    try {
        const { driveService } = await import('./driveService');
        nervousSystem.register({
            id: 'google_apis',
            name: 'Google APIs',
            type: 'CLOUD',
            isRequired: false,
            checkHealth: async () => {
                // Ensure service is initialized before checking auth
                await driveService.init();
                return driveService.isAuthenticated();
            },
            reconnect: async () => {
                // Re-initialize and check if tokens are valid
                await driveService.init();
                return driveService.isAuthenticated();
            }
        });
    } catch (e) {
        console.warn("[NERVOUS] Google Drive service not available for monitoring");
    }

    // Start monitoring
    nervousSystem.start();

    console.log("[NERVOUS] ✅ Nervous System online. Monitoring", nervousSystem.getHealthSummary().total, "connections.");
}
