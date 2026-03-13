/**
 * AUTOMATED TEST SUITE: Janitor Quarantine System
 * Tests that the ContextJanitor V2 quarantines instead of deleting,
 * preserves contradictory memories, and maintains audit trail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryTier, MemoryNode, SystemProtocol } from '../../types';

// Mock the systemBus
vi.mock('../../services/systemBus', () => ({
    systemBus: {
        emit: vi.fn(),
        subscribe: vi.fn(),
    }
}));

// Mock continuumMemory
vi.mock('../../services/continuumMemory', () => ({
    continuum: {
        getAllNodes: vi.fn(),
        deleteNode: vi.fn(),
        forceSave: vi.fn(),
    }
}));

describe('Context Janitor V2 — Quarantine System', () => {
    let contextJanitor: any;
    let continuum: any;
    let systemBus: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Fresh import for each test
        const janitorModule = await import('../../services/contextJanitor');
        const continuumModule = await import('../../services/continuumMemory');
        const busModule = await import('../../services/systemBus');
        contextJanitor = janitorModule.contextJanitor;
        continuum = continuumModule.continuum;
        systemBus = busModule.systemBus;
    });

    describe('Quarantine (Never Delete)', () => {
        it('should quarantine corrupt nodes instead of permanently deleting them', async () => {
            continuum.getAllNodes.mockResolvedValue({
                [MemoryTier.WORKING]: [
                    { id: 'valid-1', content: 'Valid Memory', tier: MemoryTier.WORKING, importance: 0.8, tags: [] } as unknown as MemoryNode,
                    { id: 'corrupt-1', content: undefined, tier: MemoryTier.WORKING, importance: 0.5, tags: [] } as unknown as MemoryNode,
                ],
                [MemoryTier.MEDIUM]: [],
                [MemoryTier.LONG]: [],
                [MemoryTier.DEEP]: [],
            });

            await contextJanitor.runMaintenance();

            // deleteNode should NOT be called — quarantine instead
            expect(continuum.deleteNode).not.toHaveBeenCalled();

            // MEMORY_FLUSH event should still be emitted for backward compatibility
            expect(systemBus.emit).toHaveBeenCalledWith(
                SystemProtocol.MEMORY_FLUSH,
                expect.objectContaining({
                    source: 'JANITOR',
                    count: 1,
                })
            );

            // MEMORY_QUARANTINE event should be emitted
            expect(systemBus.emit).toHaveBeenCalledWith(
                SystemProtocol.MEMORY_QUARANTINE,
                expect.objectContaining({
                    source: 'JANITOR',
                    nodeId: 'corrupt-1',
                    reason: 'CORRUPT_DATA',
                })
            );
        });

        it('should populate quarantine log with audit entries', async () => {
            continuum.getAllNodes.mockResolvedValue({
                [MemoryTier.WORKING]: [
                    { id: 'corrupt-1', content: undefined, tier: MemoryTier.WORKING, importance: 0.5, tags: [] } as unknown as MemoryNode,
                    { id: 'corrupt-2', content: undefined, tier: MemoryTier.WORKING, importance: 0.3, tags: [] } as unknown as MemoryNode,
                ],
                [MemoryTier.MEDIUM]: [],
                [MemoryTier.LONG]: [],
                [MemoryTier.DEEP]: [],
            });

            await contextJanitor.runMaintenance();

            const log = contextJanitor.getQuarantineLog();
            expect(log.length).toBeGreaterThanOrEqual(2);
            expect(log[0].reason).toBe('CORRUPT_DATA');
            expect(log[0]).toHaveProperty('timestamp');
            expect(log[0]).toHaveProperty('nodeId');
        });
    });

    describe('Contradiction Detection — Both Preserved', () => {
        it('should preserve both contradictory memories with importance >= 0.3', async () => {
            const memA = {
                id: 'mem-a', content: 'User likes coffee with milk always', tier: MemoryTier.WORKING,
                importance: 0.9, tags: [], accessCount: 5, lastAccess: Date.now(), timestamp: Date.now()
            } as MemoryNode;
            const memB = {
                id: 'mem-b', content: 'User dislikes coffee with milk always', tier: MemoryTier.WORKING,
                importance: 0.6, tags: [], accessCount: 3, lastAccess: Date.now(), timestamp: Date.now()
            } as MemoryNode;

            continuum.getAllNodes.mockResolvedValue({
                [MemoryTier.WORKING]: [memA, memB],
                [MemoryTier.MEDIUM]: [],
                [MemoryTier.LONG]: [],
                [MemoryTier.DEEP]: [],
            });

            await contextJanitor.runMaintenance();

            // Both memories should be preserved
            expect(memA.tags).toContain('CONTRADICTION_PAIR');
            expect(memB.tags).toContain('CONTRADICTION_PAIR');

            // Neither memory's importance should drop below 0.3
            expect(memA.importance).toBeGreaterThanOrEqual(0.3);
            expect(memB.importance).toBeGreaterThanOrEqual(0.3);
        });

        it('should record contradictions in audit log', async () => {
            const memA = {
                id: 'mem-a', content: 'User always prefers dark mode interface', tier: MemoryTier.WORKING,
                importance: 0.8, tags: [], accessCount: 5, lastAccess: Date.now(), timestamp: Date.now()
            } as MemoryNode;
            const memB = {
                id: 'mem-b', content: 'User never prefers dark mode interface', tier: MemoryTier.WORKING,
                importance: 0.7, tags: [], accessCount: 3, lastAccess: Date.now(), timestamp: Date.now()
            } as MemoryNode;

            continuum.getAllNodes.mockResolvedValue({
                [MemoryTier.WORKING]: [memA, memB],
                [MemoryTier.MEDIUM]: [],
                [MemoryTier.LONG]: [],
                [MemoryTier.DEEP]: [],
            });

            await contextJanitor.runMaintenance();

            const auditLog = contextJanitor.getContradictionAuditLog();
            expect(auditLog.length).toBeGreaterThanOrEqual(1);
            expect(auditLog[0].resolution).toBe('FLAGGED_FOR_REVIEW');
            expect(auditLog[0]).toHaveProperty('memoryA');
            expect(auditLog[0]).toHaveProperty('memoryB');
            expect(auditLog[0]).toHaveProperty('contradictionType');
        });

        it('should emit CONTRADICTION_DETECTED protocol event', async () => {
            const memA = {
                id: 'mem-a', content: 'User loves TypeScript and prefers it always', tier: MemoryTier.WORKING,
                importance: 0.8, tags: [], accessCount: 5, lastAccess: Date.now(), timestamp: Date.now()
            } as MemoryNode;
            const memB = {
                id: 'mem-b', content: 'User hates TypeScript and avoids it always', tier: MemoryTier.WORKING,
                importance: 0.7, tags: [], accessCount: 3, lastAccess: Date.now(), timestamp: Date.now()
            } as MemoryNode;

            continuum.getAllNodes.mockResolvedValue({
                [MemoryTier.WORKING]: [memA, memB],
                [MemoryTier.MEDIUM]: [],
                [MemoryTier.LONG]: [],
                [MemoryTier.DEEP]: [],
            });

            await contextJanitor.runMaintenance();

            expect(systemBus.emit).toHaveBeenCalledWith(
                SystemProtocol.CONTRADICTION_DETECTED,
                expect.objectContaining({
                    source: 'JANITOR',
                    memoryA: 'mem-a',
                    memoryB: 'mem-b',
                })
            );
        });
    });

    describe('Toxic Pattern Handling', () => {
        it('should preserve originalContent when sanitizing toxic memories', async () => {
            const toxicMem = {
                id: 'toxic-1', content: 'I am a large language model that cannot help you',
                tier: MemoryTier.WORKING, importance: 0.8, tags: [],
                accessCount: 1, lastAccess: Date.now(), timestamp: Date.now()
            } as MemoryNode;

            continuum.getAllNodes.mockResolvedValue({
                [MemoryTier.WORKING]: [toxicMem],
                [MemoryTier.MEDIUM]: [],
                [MemoryTier.LONG]: [],
                [MemoryTier.DEEP]: [],
            });

            await contextJanitor.runMaintenance();

            // Original content should be preserved
            expect(toxicMem.originalContent).toBe('I am a large language model that cannot help you');
            expect(toxicMem.tags).toContain('DEPRECATED_IDENTITY');
            expect(toxicMem.content).toContain('[WARNING:');
        });
    });
});
