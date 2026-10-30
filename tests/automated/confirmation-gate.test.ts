import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.CONFIRMATION_GATE_DIR = mkdtempSync(join(tmpdir(), 'confirm-gate2-'));
process.env.CONFIRM_GATE_TTL_MS = '60000';
process.env.CONFIRM_GATE_REJECT_COOLDOWN_MS = '150';

const { confirmationGate, effectKey, summarizeEffect, EXTERNAL_EFFECT_TOOLS } = await import('../../services/tools/confirmationGate');

const EMAIL = { to: 'cliente@ejemplo.com', subject: 'Propuesta', body: 'Hola, adjunto propuesta completa...' };
const P1 = { principalId: 'user-alberto', conversationId: 'sesion-web-1' };

describe('gate v2: approval bound to principal + conversation + exact action', () => {
    it('first call pends with FULL content and a token; identical retry without user yes stays pending', () => {
        const d1 = confirmationGate.check('send_email', EMAIL, P1.principalId, P1.conversationId);
        expect(d1.action).toBe('PENDING');
        if (d1.action !== 'PENDING') return;
        expect(d1.pending.token).toMatch(/^[A-Z2-9]{6}$/);
        expect(d1.pending.summary).toContain('cliente@ejemplo.com');
        expect(d1.pending.summary).toContain('adjunto propuesta completa'); // full body, not truncated at 500
        // immediate and delayed retries without an authenticated yes: still pending
        expect(confirmationGate.check('send_email', EMAIL, P1.principalId, P1.conversationId).action).toBe('PENDING');
    });

    it('explicit CONFIRMAR from the same principal+conversation enables exactly ONE execution', () => {
        const d1 = confirmationGate.check('send_email', { ...EMAIL, subject: 'Unica ejecucion' }, P1.principalId, P1.conversationId);
        if (d1.action !== 'PENDING') throw new Error('expected PENDING');
        const ack = confirmationGate.handleUserCommand(`CONFIRMAR ${d1.pending.token}`, P1.principalId, P1.conversationId);
        expect(ack).toContain('confirmada');
        expect(confirmationGate.check('send_email', { ...EMAIL, subject: 'Unica ejecucion' }, P1.principalId, P1.conversationId).action).toBe('EXECUTE');
        // one-time consumption: a second identical call is a brand new pending
        expect(confirmationGate.check('send_email', { ...EMAIL, subject: 'Unica ejecucion' }, P1.principalId, P1.conversationId).action).toBe('PENDING');
    });

    it('cross-principal replay: another principal cannot confirm or consume the pending', () => {
        const d1 = confirmationGate.check('send_email', { ...EMAIL, subject: 'Cross principal' }, P1.principalId, P1.conversationId);
        if (d1.action !== 'PENDING') throw new Error('expected PENDING');
        const ack = confirmationGate.handleUserCommand(`CONFIRMAR ${d1.pending.token}`, 'otro-usuario', P1.conversationId);
        expect(ack).toContain('no pertenece');
        expect(confirmationGate.check('send_email', { ...EMAIL, subject: 'Cross principal' }, 'otro-usuario', P1.conversationId).action).toBe('PENDING');
        expect(confirmationGate.check('send_email', { ...EMAIL, subject: 'Cross principal' }, P1.principalId, P1.conversationId).action).toBe('PENDING');
    });

    it('cross-conversation replay: confirming from another session does not approve', () => {
        const d1 = confirmationGate.check('send_email', { ...EMAIL, subject: 'Cross session' }, P1.principalId, P1.conversationId);
        if (d1.action !== 'PENDING') throw new Error('expected PENDING');
        const ack = confirmationGate.handleUserCommand(`CONFIRMAR ${d1.pending.token}`, P1.principalId, 'sesion-whatsapp-2');
        expect(ack).toContain('no pertenece');
        expect(confirmationGate.check('send_email', { ...EMAIL, subject: 'Cross session' }, P1.principalId, P1.conversationId).action).toBe('PENDING');
    });

    it('explicit RECHAZAR refuses the action during cooldown, then allows a fresh pending', async () => {
        const args = { ...EMAIL, subject: 'Rechazo explicito' };
        const d1 = confirmationGate.check('send_email', args, P1.principalId, P1.conversationId);
        if (d1.action !== 'PENDING') throw new Error('expected PENDING');
        const ack = confirmationGate.handleUserCommand(`RECHAZAR ${d1.pending.token}`, P1.principalId, P1.conversationId);
        expect(ack).toContain('rechazada');
        expect(confirmationGate.check('send_email', args, P1.principalId, P1.conversationId).action).toBe('REJECTED');
        await new Promise(r => setTimeout(r, 200)); // cooldown over
        expect(confirmationGate.check('send_email', args, P1.principalId, P1.conversationId).action).toBe('PENDING');
    });

    it('changed args after an approval are a NEW pending, never executed', () => {
        const d1 = confirmationGate.check('send_email', { ...EMAIL, subject: 'Cambio args' }, P1.principalId, P1.conversationId);
        if (d1.action !== 'PENDING') throw new Error('expected PENDING');
        confirmationGate.handleUserCommand(`CONFIRMAR ${d1.pending.token}`, P1.principalId, P1.conversationId);
        const changed = confirmationGate.check('send_email', { ...EMAIL, subject: 'Cambio args EDITADO' }, P1.principalId, P1.conversationId);
        expect(changed.action).toBe('PENDING');
        expect(effectKey('send_email', EMAIL)).not.toBe(effectKey('send_email', { ...EMAIL, subject: 'x' }));
    });

    it('argument order does not matter for identity', () => {
        expect(effectKey('send_email', EMAIL)).toBe(effectKey('send_email', { body: EMAIL.body, subject: EMAIL.subject, to: EMAIL.to }));
    });

    it('no user reply: the action never executes and expires', () => {
        const args = { ...EMAIL, subject: 'Sin respuesta' };
        expect(confirmationGate.check('send_email', args, P1.principalId, P1.conversationId).action).toBe('PENDING');
        expect(confirmationGate.check('send_email', args, P1.principalId, P1.conversationId).action).toBe('PENDING');
    });

    it('missing principal or conversation is BLOCKED_NO_PRINCIPAL (fail-closed)', () => {
        expect(confirmationGate.check('send_email', EMAIL, undefined, 'c').action).toBe('BLOCKED_NO_PRINCIPAL');
        expect(confirmationGate.check('send_email', EMAIL, 'u', undefined).action).toBe('BLOCKED_NO_PRINCIPAL');
    });

    it('persists pending actions to disk (restart-safe)', () => {
        const store = join(process.env.CONFIRMATION_GATE_DIR!, 'consent-ledger.jsonl');
        const events = readFileSync(store, 'utf8').trim().split('\n').map(l => JSON.parse(l));
        const rows = events.filter(ev => ev.op === 'PUT').map(ev => ev.rec);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].token).toBeDefined();
        expect(rows[0].principalId).toBeDefined();
        expect(rows[0].conversationId).toBeDefined();
    });

    it('chat integration routes effects through the gate BEFORE execution and threads context', () => {
        const src = readFileSync(join(__dirname, '../../services/chatToolIntegration.ts'), 'utf8');
        expect(src).toContain('PENDING_CONFIRMATION');
        expect(src).toContain('BLOCKED_NO_PRINCIPAL');
        expect(src.indexOf('confirmationGate.check')).toBeLessThan(src.indexOf('orchestrator.executeCapability'));
        expect(src).toContain('gateContext?.principalId');
        const controller = readFileSync(join(__dirname, '../../server/controllers/chatController.ts'), 'utf8');
        expect(controller).toContain('confirmationGate.handleUserCommand(userMessage, userId, cleanSessionId)');
        expect(controller.match(/principalId: userId, conversationId: cleanSessionId/g)?.length).toBe(2);
        expect(EXTERNAL_EFFECT_TOOLS.has('send_email')).toBe(true);
        expect(EXTERNAL_EFFECT_TOOLS.has('github_create_pr')).toBe(true);
    });
});
