/**
 * OPERATION CIRCUIT BREAKER - Protects Against Cascading Failures
 * 
 * Extends providerHealthManager pattern to:
 * 1. Track failures per operation type
 * 2. Suspend operations that fail repeatedly
 * 3. Auto-recover after cooldown
 * 4. Emit health events
 * 
 * Part of the Crash-Proof Resilience Layer (Phase 4)
 */

import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// ==================== INTERFACES ====================

export type OperationType =
    | 'TOOL_CREATE'
    | 'TOOL_EXECUTE'
    | 'AGENT_ANALYZE'
    | 'AGENT_EVOLVE'
    | 'LLM_GENERATE';

export interface OperationState {
    type: OperationType;
    status: 'HEALTHY' | 'DEGRADED' | 'OPEN';
    consecutiveFailures: number;
    totalFailures: number;
    totalSuccesses: number;
    suspendedUntil: number;
    lastError?: string;
    lastSuccess?: number;
}

export interface CircuitConfig {
    failureThreshold: number;    // Failures before DEGRADED (default: 3)
    openThreshold: number;       // Failures before OPEN (default: 5)
    cooldownMs: number;          // Time before retry (default: 60000)
    halfOpenMaxCalls: number;    // Calls allowed in DEGRADED (default: 1)
}

// ==================== DEFAULT CONFIG ====================

const DEFAULT_CONFIG: CircuitConfig = {
    failureThreshold: 3,
    openThreshold: 5,
    cooldownMs: 60000,  // 1 minute
    halfOpenMaxCalls: 1
};

// ==================== OPERATION CIRCUIT ====================

class OperationCircuit {
    private static instance: OperationCircuit;
    private states: Map<OperationType, OperationState> = new Map();
    private config: CircuitConfig = DEFAULT_CONFIG;

    private constructor() {
        // Initialize all operation types
        const types: OperationType[] = [
            'TOOL_CREATE',
            'TOOL_EXECUTE',
            'AGENT_ANALYZE',
            'AGENT_EVOLVE',
            'LLM_GENERATE'
        ];

        for (const type of types) {
            this.resetState(type);
        }
    }

    public static getInstance(): OperationCircuit {
        if (!OperationCircuit.instance) {
            OperationCircuit.instance = new OperationCircuit();
        }
        return OperationCircuit.instance;
    }

    /**
     * Check if operation is allowed
     */
    public canExecute(type: OperationType): boolean {
        const state = this.getState(type);

        switch (state.status) {
            case 'HEALTHY':
                return true;

            case 'DEGRADED':
                // Allow limited calls to test recovery
                if (Date.now() >= state.suspendedUntil) {
                    console.log(`[Circuit] 🟡 ${type} in DEGRADED state, allowing probe call`);
                    return true;
                }
                return false;

            case 'OPEN':
                // Check if cooldown has passed
                if (Date.now() >= state.suspendedUntil) {
                    console.log(`[Circuit] 🟡 ${type} cooldown complete, transitioning to DEGRADED`);
                    state.status = 'DEGRADED';
                    return true;
                }
                console.log(`[Circuit] 🔴 ${type} is OPEN. Blocked until ${new Date(state.suspendedUntil).toLocaleTimeString()}`);
                return false;
        }
    }

    /**
     * Report successful operation
     */
    public reportSuccess(type: OperationType): void {
        const state = this.getState(type);

        state.totalSuccesses++;
        state.lastSuccess = Date.now();

        if (state.consecutiveFailures > 0) {
            console.log(`[Circuit] ✅ ${type} recovered after ${state.consecutiveFailures} failures`);
        }

        state.consecutiveFailures = 0;
        state.status = 'HEALTHY';
        state.suspendedUntil = 0;
        state.lastError = undefined;
    }

    /**
     * Report failed operation
     */
    public reportFailure(type: OperationType, error: string): void {
        const state = this.getState(type);

        state.consecutiveFailures++;
        state.totalFailures++;
        state.lastError = error;

        // Determine new status
        if (state.consecutiveFailures >= this.config.openThreshold) {
            state.status = 'OPEN';
            state.suspendedUntil = Date.now() + this.config.cooldownMs * 2; // Double cooldown for OPEN
            console.warn(`[Circuit] 🔴 ${type} CIRCUIT OPEN. ${state.consecutiveFailures} consecutive failures.`);
        } else if (state.consecutiveFailures >= this.config.failureThreshold) {
            state.status = 'DEGRADED';
            state.suspendedUntil = Date.now() + this.config.cooldownMs;
            console.warn(`[Circuit] 🟡 ${type} DEGRADED. ${state.consecutiveFailures} consecutive failures.`);
        }

        // Emit health event
        systemBus.emit(SystemProtocol.UI_REFRESH, {
            source: 'OPERATION_CIRCUIT',
            type: 'CIRCUIT_STATE_CHANGE',
            operation: type,
            state: state.status,
            failures: state.consecutiveFailures
        });
    }

    /**
     * Execute with circuit breaker protection
     */
    public async execute<T>(
        type: OperationType,
        fn: () => Promise<T>
    ): Promise<T> {
        if (!this.canExecute(type)) {
            throw new Error(`Circuit OPEN for ${type}. Try again later.`);
        }

        try {
            const result = await fn();
            this.reportSuccess(type);
            return result;
        } catch (error: any) {
            this.reportFailure(type, error?.message || String(error));
            throw error;
        }
    }

    /**
     * Get state for operation type
     */
    private getState(type: OperationType): OperationState {
        if (!this.states.has(type)) {
            this.resetState(type);
        }
        return this.states.get(type)!;
    }

    /**
     * Reset state to healthy
     */
    public resetState(type: OperationType): void {
        this.states.set(type, {
            type,
            status: 'HEALTHY',
            consecutiveFailures: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            suspendedUntil: 0
        });
    }

    /**
     * Reset all circuits
     */
    public resetAll(): void {
        for (const type of this.states.keys()) {
            this.resetState(type);
        }
        console.log('[Circuit] 🔄 All circuits reset to HEALTHY');
    }

    /**
     * Get health stats for all operations
     */
    public getHealthStats(): Record<OperationType, OperationState> {
        return Object.fromEntries(this.states) as Record<OperationType, OperationState>;
    }

    /**
     * Get summary for logging/display
     */
    public getSummary(): {
        healthy: number;
        degraded: number;
        open: number;
        details: { type: OperationType; status: string; failures: number }[];
    } {
        let healthy = 0, degraded = 0, open = 0;
        const details: { type: OperationType; status: string; failures: number }[] = [];

        for (const [type, state] of this.states) {
            details.push({
                type: type as OperationType,
                status: state.status,
                failures: state.consecutiveFailures
            });

            switch (state.status) {
                case 'HEALTHY': healthy++; break;
                case 'DEGRADED': degraded++; break;
                case 'OPEN': open++; break;
            }
        }

        return { healthy, degraded, open, details };
    }

    /**
     * Configure circuit breaker
     */
    public configure(config: Partial<CircuitConfig>): void {
        this.config = { ...this.config, ...config };
    }
}

export const operationCircuit = OperationCircuit.getInstance();
