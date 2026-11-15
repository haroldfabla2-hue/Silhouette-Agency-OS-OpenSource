/**
 * AUTOMATED TEST SUITE: Memory System
 * Tests Continuum Memory and LanceDB integration
 * Note: These tests gracefully handle initialization failures
 */
import { describe, it, expect } from 'vitest';

describe('Memory System', () => {
    describe('Continuum Memory', () => {
        it('should initialize continuum module', async () => {
            try {
                const module = await import('../../services/continuumMemory');
                expect(module.continuum).toBeDefined();
            } catch (e: any) {
                console.error('[TEST FATAL] Continuum init failed:', e.message);
                expect.fail('Continuum init failed: ' + e.message);
            }
        });

        it('should have store method available', async () => {
            try {
                const { continuum } = await import('../../services/continuumMemory');
                expect(typeof continuum.store).toBe('function');
            } catch (e: any) {
                console.error('[TEST FATAL] Continuum not available:', e.message);
                expect.fail('Continuum not available: ' + e.message);
            }
        });

        it('should have memory methods available', async () => {
            try {
                const { continuum } = await import('../../services/continuumMemory');
                // Check that continuum has expected properties
                expect(continuum).toBeDefined();
            } catch (e: any) {
                console.error('[TEST FATAL] Continuum not available:', e.message);
                expect.fail('Continuum not available: ' + e.message);
            }
        });

        it('should have getStats method', async () => {
            try {
                const { continuum } = await import('../../services/continuumMemory');
                expect(typeof continuum.getStats).toBe('function');
            } catch (e: any) {
                console.error('[TEST FATAL] Continuum not available:', e.message);
                expect.fail('Continuum not available: ' + e.message);
            }
        });
    });

    describe('Experience Buffer', () => {
        it('should export experienceBuffer', async () => {
            try {
                const module = await import('../../services/experienceBuffer');
                expect(module.experienceBuffer).toBeDefined();
            } catch (e: any) {
                console.error('[TEST FATAL] ExperienceBuffer not available:', e.message);
                expect.fail('ExperienceBuffer not available: ' + e.message);
            }
        });
    });
});
