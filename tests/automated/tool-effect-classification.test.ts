/**
 * tool-effect-classification — WRITTEN 2026-11-05, NOT EXECUTED.
 *
 * All test runs are paused pending an approved isolation design
 * (2026-11-02 isolation incident: a copy of the app reached the live
 * Neo4j/Redis). Do NOT run on the host until isolation is approved.
 * Once approved:  npx vitest run tests/automated/tool-effect-classification.test.ts
 *
 * Covers the plugin confirmation-gate bypass fix (classification-driven
 * isGatedEffect, fail-closed unclassified, full-args binding, boundary
 * placement, CERO COBROS for wallet-declared tools without policy).
 */
import { describe, it, expect } from 'vitest';
import { toolRegistry } from '../../services/tools/toolRegistry';
import {
    getToolEffectClass, requiresHumanConfirmation, CORE_TOOL_EFFECTS,
} from '../../services/security/toolEffects';
import {
    isGatedEffect, isCapabilityLevelBoundary, effectBinding, ensureEffectConsent,
} from '../../services/security/effectGate';

const fakeTool = (name: string, effects?: any) => ({
    id: `test_${name}`,
    name,
    description: 'test tool',
    parameters: { type: 'OBJECT', properties: {} },
    handler: { type: 'BUILTIN', handlerName: 'PLUGIN:test:x' },
    category: 'UTILITY',
    createdBy: 'SYSTEM',
    enabled: true,
    usageCount: 0,
    successCount: 0,
    createdAt: Date.now(),
    version: '0.0.0',
    effects,
} as any);

describe('tool effect classification (plugin gate root fix)', () => {
    it('keeps the original five dedicated kinds gated', () => {
        for (const k of ['send_email', 'github_create_pr', 'generate_image', 'generate_video', 'generate_voice']) {
            expect(isGatedEffect(k)).toBe(true);
        }
    });

    it('does not gate internal or read-only core tools (legacy behavior preserved)', () => {
        for (const n of ['write_file', 'workspace_create', 'execute_code', 'web_search', 'read_file', 'list_files']) {
            expect(isGatedEffect(n)).toBe(false);
        }
    });

    it('classifies bundled plugin tools as declared; mutations gate, reads do not', () => {
        expect(getToolEffectClass('trello_create_card')).toBe('external_publish');
        expect(isGatedEffect('trello_create_card')).toBe(true);
        expect(getToolEffectClass('trello_list_boards')).toBe('read_only');
        expect(isGatedEffect('trello_list_boards')).toBe(false);
        expect(getToolEffectClass('google_gmail_send')).toBe('external_comms');
        expect(isGatedEffect('google_gmail_send')).toBe(true);
        expect(getToolEffectClass('google_gmail_list')).toBe('read_only');
        expect(isGatedEffect('google_gmail_list')).toBe(false);
        expect(isGatedEffect('notion_create_page')).toBe(true);
        expect(isGatedEffect('google_calendar_create_event')).toBe(true);
        expect(isGatedEffect('google_sheets_write')).toBe(true);
    });

    it('fails closed: an undeclared registered tool is unclassified and gated', () => {
        toolRegistry.registerTool(fakeTool('test_undeclared_tool'));
        expect(getToolEffectClass('test_undeclared_tool')).toBe('unclassified');
        expect(requiresHumanConfirmation('unclassified')).toBe(true);
        expect(isGatedEffect('test_undeclared_tool')).toBe(true);
    });

    it('fails closed for completely unknown names too', () => {
        expect(getToolEffectClass('never_registered_xyz')).toBe('unclassified');
        expect(isGatedEffect('never_registered_xyz')).toBe(true);
    });

    it('registered metadata wins over the unclassified fallback', () => {
        toolRegistry.registerTool(fakeTool('test_declared_read', 'read_only'));
        expect(getToolEffectClass('test_declared_read')).toBe('read_only');
        expect(isGatedEffect('test_declared_read')).toBe(false);
    });

    it('generic effects bind the FULL canonical args (no subset collapse)', () => {
        const b1 = effectBinding('trello_create_card', { listId: 'L1', name: 'a' });
        const b2 = effectBinding('trello_create_card', { listId: 'L1', name: 'b' });
        const b3 = effectBinding('trello_create_card', { listId: 'L1', name: 'a' });
        expect(b1.destination).not.toBe(b2.destination);
        expect(b1.destination).toBe(b3.destination);
        expect(b1.type).toBe('trello_create_card');
    });

    it('capability-level boundary: plugin/unclassified consume at the chokepoint; dedicated provider-boundary kinds do not', () => {
        expect(isCapabilityLevelBoundary('github_create_pr')).toBe(true);
        expect(isCapabilityLevelBoundary('trello_create_card')).toBe(true);
        expect(isCapabilityLevelBoundary('never_registered_xyz')).toBe(true);
        expect(isCapabilityLevelBoundary('send_email')).toBe(false);
        expect(isCapabilityLevelBoundary('generate_image')).toBe(false);
    });

    it('CERO COBROS: a wallet-declared tool without a dedicated policy is hard-denied, no grant saves it', async () => {
        toolRegistry.registerTool(fakeTool('test_paid_tool', 'wallet_bearing'));
        expect(isGatedEffect('test_paid_tool')).toBe(true);
        await expect(ensureEffectConsent('test_paid_tool', { x: 1 }, 'test-origin'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
    });

    it('every CORE_TOOL_EFFECTS value is a valid class', () => {
        const valid = new Set(['read_only', 'internal', 'external_comms', 'external_publish', 'wallet_bearing']);
        for (const [name, cls] of Object.entries(CORE_TOOL_EFFECTS)) {
            expect(valid.has(cls), `${name} has invalid class ${cls}`).toBe(true);
        }
    });
});
