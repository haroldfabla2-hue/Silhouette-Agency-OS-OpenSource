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
 *
 * Review fix (R8): the bundled plugins are NOT auto-registered in a bare
 * vitest process, so the test registers their REAL metadata (name +
 * declared effects) explicitly before asserting on the resolver. The
 * plugin module imports must stay side-effect-free (object definitions +
 * a warning-only onInit); if that ever changes, switch to dynamic import
 * inside beforeAll and declare it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { toolRegistry } from '../../services/tools/toolRegistry';
import {
    getToolEffectClass, requiresHumanConfirmation, CORE_TOOL_EFFECTS,
} from '../../services/security/toolEffects';
import {
    isGatedEffect, isCapabilityLevelBoundary, effectBinding, ensureEffectConsent,
} from '../../services/security/effectGate';
import trelloPlugin from '../../services/plugins/integrations/trelloPlugin';
import notionPlugin from '../../services/plugins/integrations/notionPlugin';
import { buildGoogleWorkspaceTools } from '../../services/plugins/integrations/googleWorkspacePlugin';

const stubTool = (name: string, effects?: any) => ({
    id: `test_${name}`,
    name,
    description: 'test tool',
    parameters: { type: 'OBJECT', properties: {} },
    handler: { type: 'BUILTIN', handlerName: `PLUGIN:test:${name}` },
    category: 'UTILITY',
    createdBy: 'SYSTEM',
    enabled: true,
    usageCount: 0,
    successCount: 0,
    createdAt: Date.now(),
    version: '0.0.0',
    effects,
} as any);

beforeAll(() => {
    // Register the REAL plugin metadata (not handlers): exactly what
    // pluginRegistry.initialize() propagates to toolRegistry at boot.
    // trello/notion expose static tool arrays; google's plugin.tools
    // getter is EMPTY until onInit reads real config, so the test uses
    // the pure buildGoogleWorkspaceTools() builder (no config, no I/O).
    for (const t of [...trelloPlugin.tools, ...notionPlugin.tools, ...buildGoogleWorkspaceTools()]) {
        toolRegistry.registerTool(stubTool(t.name, (t as any).effects));
    }
});

describe('tool effect classification (plugin gate root fix)', () => {
    it('every bundled plugin tool DECLARES its effects (registration metadata present)', () => {
        const all = [
            ...trelloPlugin.tools.map(t => ({ plugin: 'trello', t })),
            ...notionPlugin.tools.map(t => ({ plugin: 'notion', t })),
            ...buildGoogleWorkspaceTools().map(t => ({ plugin: 'google-workspace', t })),
        ];
        expect(all.length).toBe(18); // 3 trello + 2 notion + 13 google - a vacuous pass is a failure
        for (const { plugin, t } of all) {
            expect((t as any).effects, `${plugin}:${t.name} missing effects declaration`).toBeTruthy();
        }
    });

    it('keeps the original five dedicated kinds gated', () => {
        for (const k of ['send_email', 'github_create_pr', 'generate_image', 'generate_video', 'generate_voice']) {
            expect(isGatedEffect(k)).toBe(true);
        }
    });

    it('does not gate internal, read-only, external_read or domain_gated core tools (legacy behavior preserved)', () => {
        for (const n of ['write_file', 'workspace_create', 'execute_code', 'web_search', 'read_file',
            'get_emails', 'read_inbox', 'browser_navigate', 'payments_status', 'request_collaboration']) {
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

    it('gates external comms/publish core effects (telephony, side-effecting browser actions)', () => {
        expect(isGatedEffect('telephony_dial_phone')).toBe(true);
        expect(isGatedEffect('browser_action')).toBe(true);
        expect(isGatedEffect('browser_click_coordinate')).toBe(true);
    });

    it('fails closed: an undeclared registered tool is unclassified and gated', () => {
        toolRegistry.registerTool(stubTool('test_undeclared_tool'));
        expect(getToolEffectClass('test_undeclared_tool')).toBe('unclassified');
        expect(requiresHumanConfirmation('unclassified')).toBe(true);
        expect(isGatedEffect('test_undeclared_tool')).toBe(true);
    });

    it('fails closed for completely unknown names too', () => {
        expect(getToolEffectClass('never_registered_xyz')).toBe('unclassified');
        expect(isGatedEffect('never_registered_xyz')).toBe(true);
    });

    it('dynamic DB tools resolve via pattern as read_only (current Safe Mode: readonly connection + SELECT-only)', () => {
        expect(getToolEffectClass('query_customers_db_main')).toBe('read_only');
        expect(isGatedEffect('query_customers_db_main')).toBe(false);
    });

    it('registered metadata wins over the unclassified fallback', () => {
        toolRegistry.registerTool(stubTool('test_declared_read', 'read_only'));
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
        toolRegistry.registerTool(stubTool('test_paid_tool', 'wallet_bearing'));
        expect(isGatedEffect('test_paid_tool')).toBe(true);
        await expect(ensureEffectConsent('test_paid_tool', { x: 1 }, 'test-origin'))
            .rejects.toMatchObject({ code: 'EFFECT_DENIED' });
    });

    it('every CORE_TOOL_EFFECTS value is a valid class', () => {
        const valid = new Set(['read_only', 'internal', 'external_read', 'external_comms',
            'external_publish', 'wallet_bearing', 'domain_gated']);
        for (const [name, cls] of Object.entries(CORE_TOOL_EFFECTS)) {
            expect(valid.has(cls), `${name} has invalid class ${cls}`).toBe(true);
        }
    });

    it('direct paths: ungated effect passes through executeWithEffectConsent without consent infra', async () => {
        const { executeWithEffectConsent } = await import('../../services/security/gatedExecution');
        const r = await executeWithEffectConsent('query_x_db_y', { q: 1 }, 'test-origin', () => Promise.resolve(42));
        expect(r).toBe(42);
    });

    it('direct paths: external MCP tool names gate fail-closed (unclassified)', () => {
        expect(isGatedEffect('mcp_external:instagram:post')).toBe(true);
    });

    it('external-client boundary: only read classes are exposable to API-key clients', async () => {
        const { isExternallyExposable } = await import('../../services/security/toolEffects');
        expect(isExternallyExposable('execute_code')).toBe(false);   // internal -> RCE-equivalent for external callers
        expect(isExternallyExposable('write_file')).toBe(false);     // internal
        expect(isExternallyExposable('send_email')).toBe(false);     // external_comms, gated
        expect(isExternallyExposable('never_registered_xyz')).toBe(false); // unclassified fail-closed
        expect(isExternallyExposable('query_x_db_y')).toBe(true);    // read_only
        expect(isExternallyExposable('web_search')).toBe(true);      // read_only
    });

    it('send_email binding covers driveLink: a link change is a different approval', () => {
        const b1 = effectBinding('send_email', { to: 'a@b.c', subject: 's', body: 'x', driveLink: 'https://drive/1' });
        const b2 = effectBinding('send_email', { to: 'a@b.c', subject: 's', body: 'x', driveLink: 'https://drive/2' });
        const b3 = effectBinding('send_email', { to: 'a@b.c', subject: 's', body: 'x' });
        expect(b1.destination).not.toBe(b2.destination);
        expect(b1.destination).not.toBe(b3.destination);
    });
});
