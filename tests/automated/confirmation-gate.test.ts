import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.CONFIRMATION_GATE_DIR = mkdtempSync(join(tmpdir(), 'confirm-gate-'));
process.env.CONFIRM_GATE_MIN_AGE_MS = '50';

const { confirmationGate, effectKey, summarizeEffect, EXTERNAL_EFFECT_TOOLS } = await import('../../services/tools/confirmationGate');

const EMAIL = { to: 'cliente@ejemplo.com', subject: 'Propuesta', body: 'Hola, adjunto propuesta...' };

describe('confirmation gate for external effects', () => {
    it('first call pends with a recipient+content summary; identical confirmed call executes', async () => {
        const first = confirmationGate.gate('send_email', EMAIL);
        expect(first).not.toBeNull();
        expect(first!.summary).toContain('cliente@ejemplo.com');
        expect(first!.summary).toContain('Propuesta');

        await new Promise(r => setTimeout(r, 80)); // pass the anti same-turn-retry window
        const second = confirmationGate.gate('send_email', EMAIL);
        expect(second).toBeNull(); // confirmed -> may execute
        expect(confirmationGate.pendingCount()).toBe(0);
    });

    it('changed arguments after a pending create a NEW pending (no execution)', () => {
        confirmationGate.gate('send_email', EMAIL);
        const changed = confirmationGate.gate('send_email', { ...EMAIL, subject: 'Propuesta EDITADA' });
        expect(changed).not.toBeNull();
        expect(changed!.summary).toContain('EDITADA');
        expect(effectKey('send_email', EMAIL)).not.toBe(effectKey('send_email', { ...EMAIL, subject: 'Propuesta EDITADA' }));
    });

    it('argument order does not matter for identity', () => {
        expect(effectKey('send_email', EMAIL)).toBe(effectKey('send_email', { body: EMAIL.body, subject: EMAIL.subject, to: EMAIL.to }));
    });

    it('a too-fresh identical retry keeps waiting (anti same-turn-retry)', () => {
        confirmationGate.gate('send_email', { to: 'a@b.c', subject: 's', body: 'b' });
        const retry = confirmationGate.gate('send_email', { to: 'a@b.c', subject: 's', body: 'b' });
        expect(retry).not.toBeNull(); // still pending, not executed
    });

    it('persists pending effects to disk', () => {
        const store = join(process.env.CONFIRMATION_GATE_DIR!, 'pending-effects.json');
        const rows = JSON.parse(readFileSync(store, 'utf8'));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].summary).toBeDefined();
    });

    it('chat integration routes external-effect tools through the gate BEFORE execution', () => {
        const src = readFileSync(join(__dirname, '../../services/chatToolIntegration.ts'), 'utf8');
        expect(src).toContain('PENDING_CONFIRMATION');
        expect(src.indexOf('confirmationGate.gate')).toBeLessThan(src.indexOf('orchestrator.executeCapability'));
        expect(EXTERNAL_EFFECT_TOOLS.has('send_email')).toBe(true);
        expect(EXTERNAL_EFFECT_TOOLS.has('github_create_pr')).toBe(true);
    });

    it('summaries never invent fields', () => {
        expect(summarizeEffect('github_create_pr', { title: 'T', head: 'f', base: 'main' })).toContain('"T"');
    });
});
