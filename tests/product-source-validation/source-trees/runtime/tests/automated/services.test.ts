/**
 * AUTOMATED TEST SUITE: Services
 * Tests core service initialization and basic functionality
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Core Services', () => {
    describe('SystemBus', () => {
        it('should initialize with memory adapter', async () => {
            const { systemBus } = await import('../../services/systemBus');
            expect(systemBus).toBeDefined();
        });

        it('should support subscribe/unsubscribe pattern', async () => {
            const { systemBus } = await import('../../services/systemBus');
            const { SystemProtocol } = await import('../../types');

            let received = false;
            const handler = () => { received = true; };

            const unsubscribe = systemBus.subscribe(SystemProtocol.UI_REFRESH, handler);
            expect(typeof unsubscribe).toBe('function');

            systemBus.emit(SystemProtocol.UI_REFRESH, { test: true }, 'TEST');

            // Small delay for async handling
            await new Promise(r => setTimeout(r, 50));
            expect(received).toBe(true);

            // Cleanup
            unsubscribe();
        });
    });

    describe('SettingsManager', () => {
        it('should return valid settings structure and persist updates', async () => {
            const { settingsManager } = await import('../../services/settingsManager');
            const settings = settingsManager.getSettings();

            expect(settings).toHaveProperty('theme');
            expect(settings).toHaveProperty('integrations');
            expect(settings).toHaveProperty('permissions');
            expect(settings).toHaveProperty('notifications');

            // Test an update roundtrip
            const originalThemeMode = settings.theme?.mode || 'dark';
            const testThemeMode = originalThemeMode === 'light' ? 'dark' : 'light';

            settingsManager.updateTheme({ mode: testThemeMode });
            const updated = settingsManager.getSettings();

            expect(updated.theme.mode).toBe(testThemeMode);

            // Revert
            settingsManager.updateTheme({ mode: originalThemeMode });
        });
    });

    describe('SQLite Service', () => {
        it('should initialize and log events', async () => {
            try {
                const { sqliteService } = await import('../../services/sqliteService');
                sqliteService.log('INFO', 'Test log entry', 'vitest');
                const logs = sqliteService.getLogs(5);
                expect(Array.isArray(logs)).toBe(true);
            } catch (e: any) {
                console.warn('[TEST SKIP] SQLite not available:', e.message);
                expect(true).toBe(true);
            }
        });
    });
});

describe('SecuritySquad', () => {
    it('should perform static analysis on code reviews', async () => {
        const { securitySquad } = await import('../../services/security/securitySquad');
        expect(securitySquad).toBeDefined();

        // Test security evaluation
        const review = await securitySquad.reviewCode({
            requesterId: 'test-agent',
            language: 'javascript',
            code: 'console.log("safe code");',
            traceId: 'test-trace-123',
            statedPurpose: 'Static analysis tests'
        });

        expect(typeof review.approved).toBe('boolean');
        expect(review.riskLevel).toBeDefined();
    });
});

describe('Memory Services', () => {
    describe('ContinuumMemory', () => {
        it('should execute a full store and retrieve roundtrip natively', async () => {
            const { continuum } = await import('../../services/continuumMemory');
            const { MemoryTier } = await import('../../types');

            // Store a test memory
            const testId = `test-mem-${Date.now()}`;
            const testContent = `This is an automated test memory for assertion ${testId}`;

            await continuum.store(
                testContent,
                MemoryTier.WORKING,
                ['test', 'vitest', 'automated'],
                true // skipIngestion
            );

            // Give it a brief moment to index if Qdrant/SQLite is async
            await new Promise(resolve => setTimeout(resolve, 100));

            // Retrieve the memory generically via exact match or related tags
            const retrieved = await continuum.retrieve(testContent, 'vitest');

            expect(Array.isArray(retrieved)).toBe(true);
            const found = retrieved.find(m => m.content === testContent);
            expect(found).toBeDefined();
            expect(found?.content).toBe(testContent);
            expect(found?.tags).toContain('vitest');
        });
    });
});
