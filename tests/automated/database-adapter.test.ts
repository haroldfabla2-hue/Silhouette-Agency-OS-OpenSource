// =============================================================================
// Database Adapter Test Suite
// Tests both SQLite and PostgreSQL adapters through the IDatabaseAdapter interface.
// Ensures behavioral parity between backends.
//
// Usage:
//   npx vitest run tests/automated/database-adapter.test.ts
//   DATABASE_URL=postgresql://... npx vitest run tests/automated/database-adapter.test.ts
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDatabaseAdapter, UserRole } from '../../services/database/databaseAdapter';

// Dynamically select which adapter to test based on DATABASE_URL
let adapter: IDatabaseAdapter;
const isPostgres = !!process.env.DATABASE_URL;
const adapterName = isPostgres ? 'PostgresAdapter' : 'SqliteAdapter';

beforeAll(async () => {
    if (isPostgres) {
        const { PostgresAdapter } = await import('../../services/database/postgresAdapter');
        adapter = new PostgresAdapter(process.env.DATABASE_URL!);
    } else {
        const { SqliteAdapter } = await import('../../services/database/sqliteAdapter');
        adapter = new SqliteAdapter();
    }
    await adapter.initialize();
}, 30000);

afterAll(async () => {
    if (adapter) {
        await adapter.close();
    }
});

describe(`IDatabaseAdapter (${adapterName})`, () => {

    // ── Agent Operations ──────────────────────────────────────────────

    describe('Agent Operations', () => {
        const testAgent = {
            id: `test-agent-${Date.now()}`,
            name: 'Test Agent',
            role: 'WORKER',
            status: 'ACTIVE',
            lastActive: Date.now(),
            capabilities: [],
            model: 'test-model',
            systemPrompt: 'Test prompt',
            temperature: 0.7,
            maxTokens: 1000,
            provider: 'test',
        };

        afterAll(async () => {
            try { await adapter.deleteAgent(testAgent.id); } catch { /* ignore */ }
        });

        it('should upsert and retrieve an agent', async () => {
            await adapter.upsertAgent(testAgent as any);
            const retrieved = await adapter.getAgent(testAgent.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.id).toBe(testAgent.id);
            expect(retrieved!.name).toBe('Test Agent');
        });

        it('should list all agents', async () => {
            const agents = await adapter.getAllAgents();
            expect(Array.isArray(agents)).toBe(true);
            expect(agents.some(a => a.id === testAgent.id)).toBe(true);
        });

        it('should delete an agent', async () => {
            await adapter.deleteAgent(testAgent.id);
            const deleted = await adapter.getAgent(testAgent.id);
            expect(deleted).toBeNull();
        });
    });

    // ── Config Operations ─────────────────────────────────────────────

    describe('Config Operations', () => {
        const testKey = `test-config-${Date.now()}`;

        it('should set and get config', async () => {
            await adapter.setConfig(testKey, { value: 42, nested: { deep: true } });
            const result = await adapter.getConfig(testKey);
            expect(result).not.toBeNull();
            expect(result.value).toBe(42);
            expect(result.nested.deep).toBe(true);
        });

        it('should return null for non-existent config', async () => {
            const result = await adapter.getConfig('nonexistent-key-xyz');
            expect(result).toBeNull();
        });

        it('should get all config', async () => {
            const config = await adapter.getAllConfig();
            expect(typeof config).toBe('object');
            expect(config[testKey]).toBeDefined();
        });
    });

    // ── Log Operations ────────────────────────────────────────────────

    describe('Log Operations', () => {
        it('should write and retrieve logs', async () => {
            await adapter.log('INFO', 'Test log message', 'test-suite', { extra: 'data' });
            const logs = await adapter.getLogs(10);
            expect(Array.isArray(logs)).toBe(true);
            expect(logs.length).toBeGreaterThan(0);
        });

        it('should get recent logs by level', async () => {
            await adapter.log('ERROR', 'Test error', 'test-suite');
            const errors = await adapter.getRecentLogs('ERROR', 60);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0].level).toBe('ERROR');
        });
    });

    // ── Chat Operations ───────────────────────────────────────────────

    describe('Chat Operations', () => {
        const sessionId = `test-session-${Date.now()}`;

        afterAll(async () => {
            try { await adapter.deleteChatSession(sessionId); } catch { /* ignore */ }
        });

        it('should create a chat session', async () => {
            const session = await adapter.createChatSession('Test Session');
            expect(session.id).toBeDefined();
            expect(session.title).toBe('Test Session');
        });

        it('should append and retrieve chat messages', async () => {
            await adapter.appendChatMessage({
                id: `msg-${Date.now()}`,
                role: 'user',
                content: 'Hello from test',
                timestamp: Date.now()
            }, sessionId);

            // The sessionId should now exist
            const history = await adapter.getChatHistory(sessionId);
            expect(Array.isArray(history)).toBe(true);
        });

        it('should list chat sessions', async () => {
            const sessions = await adapter.getChatSessions();
            expect(Array.isArray(sessions)).toBe(true);
        });

        it('should search chat history', async () => {
            const results = await adapter.searchChatHistory('Hello from test');
            expect(Array.isArray(results)).toBe(true);
        });
    });

    // ── UI State Operations ───────────────────────────────────────────

    describe('UI State Operations', () => {
        const componentId = `test-component-${Date.now()}`;

        it('should save and retrieve UI state', async () => {
            const state = { expanded: true, selectedTab: 2, filters: ['active'] };
            await adapter.saveUiState(componentId, state);
            const result = await adapter.getUiState(componentId);
            expect(result).not.toBeNull();
            expect(result.expanded).toBe(true);
            expect(result.selectedTab).toBe(2);
        });

        it('should return null for non-existent UI state', async () => {
            const result = await adapter.getUiState('nonexistent-component');
            expect(result).toBeNull();
        });
    });

    // ── Cost Metrics ──────────────────────────────────────────────────

    describe('Cost Metrics', () => {
        it('should save and retrieve cost metrics', async () => {
            const metrics = { totalCost: 15.50, apiCalls: 100, lastReset: Date.now() };
            await adapter.saveCostMetrics(metrics);
            const result = await adapter.getCostMetrics();
            expect(result).not.toBeNull();
            expect(result.totalCost).toBe(15.50);
        });
    });

    // ── Evolution History ─────────────────────────────────────────────

    describe('Evolution History', () => {
        it('should log and retrieve evolution events', async () => {
            await adapter.logEvolution({
                agentId: 'test-agent-evolution',
                agentName: 'Evo Agent',
                previousScore: 75,
                newScore: 85,
                triggerType: 'QUALITY',
                triggeredBy: 'test-suite',
                improvements: ['Better response quality']
            });

            const history = await adapter.getEvolutionHistory('test-agent-evolution', 10);
            expect(history.length).toBeGreaterThan(0);
            expect(history[0].agent_id || history[0].agentId).toBe('test-agent-evolution');
        });
    });

    // ── Identity Operations ───────────────────────────────────────────

    describe('Identity Operations', () => {
        const userId = `test-user-${Date.now()}`;

        afterAll(async () => {
            // Cleanup
            try {
                await adapter.deleteExpiredSessions();
            } catch { /* ignore */ }
        });

        it('should track hasAnyUsers', async () => {
            const result = await adapter.hasAnyUsers();
            expect(typeof result).toBe('boolean');
        });

        it('should create and retrieve a user', async () => {
            const user = await adapter.createUser({
                id: userId,
                email: `test-${Date.now()}@example.com`,
                name: 'Test User',
                role: UserRole.USER,
                googleLinked: false
            });
            expect(user.id).toBe(userId);

            const retrieved = await adapter.getUserById(userId);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.name).toBe('Test User');
        });

        it('should update a user', async () => {
            await adapter.updateUser(userId, { name: 'Updated Name' });
            const updated = await adapter.getUserById(userId);
            expect(updated!.name).toBe('Updated Name');
        });
    });

    // ── Adapter Factory ───────────────────────────────────────────────

    describe('Adapter Factory', () => {
        it('should return a valid adapter via factory', async () => {
            const { getDatabaseAdapter } = await import('../../services/database/adapterFactory');
            const factoryAdapter = await getDatabaseAdapter();
            expect(factoryAdapter).toBeDefined();
            // Verify it implements the interface by checking key methods
            expect(typeof factoryAdapter.upsertAgent).toBe('function');
            expect(typeof factoryAdapter.searchVectors).toBe('function');
            expect(typeof factoryAdapter.createUser).toBe('function');
        });
    });
});
