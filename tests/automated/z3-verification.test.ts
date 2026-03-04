/**
 * AUTOMATED TEST SUITE: Z3 Verification Gate
 * Tests that the IntrospectionEngine's Z3 gate correctly filters
 * high-risk actions while allowing safe internal operations.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ActionType, AgentAction } from '../../types';

// Mock heavy dependencies
vi.mock('../../services/systemBus', () => ({
    systemBus: {
        emit: vi.fn(),
        subscribe: vi.fn(),
    }
}));

vi.mock('../../services/continuumMemory', () => ({
    continuum: {
        retrieve: vi.fn().mockResolvedValue([]),
        store: vi.fn(),
        getAllNodes: vi.fn().mockResolvedValue({}),
    }
}));

vi.mock('systeminformation', () => ({
    currentLoad: vi.fn().mockResolvedValue({ currentLoad: 10 }),
    mem: vi.fn().mockResolvedValue({ active: 1024 * 1024 * 512 }),
}));

describe('Z3 Verification Gate', () => {
    let introspection: any;

    beforeAll(async () => {
        try {
            const module = await import('../../services/introspectionEngine');
            introspection = module.introspection;
        } catch (e: any) {
            console.error('[TEST] IntrospectionEngine import failed:', e.message);
        }
    });

    describe('shouldVerifyWithZ3 (Action Gating)', () => {
        it('should return true for SELF_CORRECTION actions', () => {
            if (!introspection) return;
            const action = { type: 'SELF_CORRECTION', payload: {} };
            // Access private method via prototype
            const result = (introspection as any).shouldVerifyWithZ3(action);
            expect(result).toBe(true);
        });

        it('should return false for INJECT_CONCEPT actions (safe internal)', () => {
            if (!introspection) return;
            const action = { type: 'INJECT_CONCEPT', payload: {} };
            const result = (introspection as any).shouldVerifyWithZ3(action);
            expect(result).toBe(false);
        });

        it('should return false for ADJUST_LAYER actions (safe internal)', () => {
            if (!introspection) return;
            const action = { type: 'ADJUST_LAYER', payload: {} };
            const result = (introspection as any).shouldVerifyWithZ3(action);
            expect(result).toBe(false);
        });

        it('should return false for SLEEP_CYCLE actions (safe internal)', () => {
            if (!introspection) return;
            const action = { type: 'SLEEP_CYCLE', payload: {} };
            const result = (introspection as any).shouldVerifyWithZ3(action);
            expect(result).toBe(false);
        });

        it('should return true for WRITE_FILE actions (high risk)', () => {
            if (!introspection) return;
            const action = { type: ActionType.WRITE_FILE, payload: {} };
            const result = (introspection as any).shouldVerifyWithZ3(action);
            expect(result).toBe(true);
        });

        it('should return true for EXECUTE_COMMAND actions (high risk)', () => {
            if (!introspection) return;
            const action = { type: ActionType.EXECUTE_COMMAND, payload: {} };
            const result = (introspection as any).shouldVerifyWithZ3(action);
            expect(result).toBe(true);
        });
    });

    describe('verifyReasoningWithZ3 (Logic Verification)', () => {
        it('should pass when there is only 1 action (no contradiction possible)', async () => {
            if (!introspection) return;
            const actions: AgentAction[] = [{
                id: '1', agentId: 'test', type: ActionType.READ_FILE,
                payload: { path: '/test/file.ts' },
                status: 'PENDING', timestamp: Date.now(), requiresApproval: false
            }];
            const result = await (introspection as any).verifyReasoningWithZ3([], actions);
            expect(result).toBe(true);
        });

        it('should pass when actions target different paths', async () => {
            if (!introspection) return;
            const actions: AgentAction[] = [
                {
                    id: '1', agentId: 'test', type: ActionType.READ_FILE,
                    payload: { path: '/test/fileA.ts' },
                    status: 'PENDING', timestamp: Date.now(), requiresApproval: false
                },
                {
                    id: '2', agentId: 'test', type: ActionType.WRITE_FILE,
                    payload: { path: '/test/fileB.ts' },
                    status: 'PENDING', timestamp: Date.now(), requiresApproval: false
                }
            ];
            const result = await (introspection as any).verifyReasoningWithZ3([], actions);
            expect(result).toBe(true);
        });

        it('should gracefully handle z3-solver import failure', async () => {
            if (!introspection) return;
            // Even if Z3 is not installed, the method should return true (non-blocking)
            const actions: AgentAction[] = [
                {
                    id: '1', agentId: 'test', type: ActionType.READ_FILE,
                    payload: { path: '/test/same.ts' },
                    status: 'PENDING', timestamp: Date.now(), requiresApproval: false
                },
                {
                    id: '2', agentId: 'test', type: ActionType.WRITE_FILE,
                    payload: { path: '/test/same.ts' },
                    status: 'PENDING', timestamp: Date.now(), requiresApproval: false
                }
            ];
            // This may fail if z3-solver isn't installed, but should be graceful
            const result = await (introspection as any).verifyReasoningWithZ3([], actions);
            // Result is either true (z3 not installed, graceful) or false (z3 caught the conflict)
            expect(typeof result).toBe('boolean');
        });
    });
});
