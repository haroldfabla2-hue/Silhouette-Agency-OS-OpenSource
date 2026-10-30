/** Durable consent ledger (R8): real on-disk store, real cross-process
 * locking, real child processes killed with SIGKILL. Two independent
 * fixture principals (not real people). No provider/model call.
 * DECLARED DOUBLES: child processes are tsx runners of the real ledger
 * module, not production servers. DECLARED LIMITS: same-host store; the
 * lock file is not a boundary against an attacker with the executor's OS
 * user (infrastructure work, not claimed). */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ConsentRecord } from '../../services/security/consentLedger';

process.env.CONFIRMATION_GATE_DIR = mkdtempSync(join(tmpdir(), 'consent-ledger-gate-'));
process.env.CONFIRM_GATE_TTL_MS = '60000';

const { ConsentLedger } = await import('../../services/security/consentLedger');
const { confirmationGate } = await import('../../services/tools/confirmationGate');

const A = { principalId: 'ledger-user-a', conversationId: 'conv-a-1' };
const B = { principalId: 'ledger-user-b', conversationId: 'conv-b-1' };

const record = (over: Partial<ConsentRecord>): ConsentRecord => ({
    token: over.token ?? 'TKN' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    key: 'k', tool: 'send_email', args: { to: 'x@fixture.invalid', body: 'b' },
    summary: 'full', principalId: A.principalId, conversationId: A.conversationId,
    status: 'PENDING', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    ...over,
});

const runChild = (dir: string, token: string, principalId: string, conversationId: string, mode: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', 'tests/fixtures/consent-ledger-child.ts',
        dir, token, principalId, conversationId, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    return { child, lines: () => out.trim().split('\n').filter(Boolean) };
};

describe('R8: durable consent ledger', () => {
    it('permit consumption is bound to the deciding principal + conversation (two independent identities)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-bind-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        expect(ledger.consumePermit(r.token, B.principalId, A.conversationId).result).toBe('WRONG_PRINCIPAL');
        expect(ledger.consumePermit(r.token, A.principalId, B.conversationId).result).toBe('WRONG_CONVERSATION');
        expect(ledger.consumePermit(r.token, A.principalId, A.conversationId).result).toBe('CONSUMED');
        expect(ledger.consumePermit(r.token, A.principalId, A.conversationId).result).toBe('LOST');
    });

    it('four concurrent processes racing one approved action get exactly ONE permit', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-race-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        const children = Array.from({ length: 4 }, () => runChild(dir, r.token, A.principalId, A.conversationId, 'race'));
        const results = await Promise.all(children.map(({ child, lines }) =>
            new Promise<any>((resolve, reject) => {
                child.on('close', () => {
                    try { resolve(JSON.parse(lines()[0]).result); } catch (e) { reject(e); }
                });
                child.on('error', reject);
            })));
        expect(results.filter(x => x === 'CONSUMED')).toHaveLength(1);
        expect(results.filter(x => x === 'LOST')).toHaveLength(3);
        expect(ledger.get(r.token)?.status).toBe('CONSUMED');
    }, 30000);

    it('SIGKILL after consuming: the CONSUMED receipt survives; nobody else gets a permit', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-kill-after-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        const { child, lines } = runChild(dir, r.token, A.principalId, A.conversationId, 'consume-then-hang');
        await new Promise<void>(resolve => {
            const poll = setInterval(() => {
                if (lines().length > 0) { clearInterval(poll); resolve(); }
            }, 25);
        });
        expect(JSON.parse(lines()[0]).result).toBe('CONSUMED');
        child.kill('SIGKILL');
        await new Promise(res => child.on('close', res));
        const after = new ConsentLedger(dir); // fresh reader: restart-level view
        const stored = after.get(r.token);
        expect(stored?.status).toBe('CONSUMED');
        expect(stored?.consumedAt).toBeTypeOf('number');
        expect(after.consumePermit(r.token, A.principalId, A.conversationId).result).toBe('LOST');
    }, 30000);

    it('SIGKILL before consuming: the record stays APPROVED and a later consumer still gets the one permit', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-kill-before-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        const { child, lines } = runChild(dir, r.token, A.principalId, A.conversationId, 'hang-forever');
        await new Promise<void>(resolve => {
            const poll = setInterval(() => {
                if (lines().includes('READY')) { clearInterval(poll); resolve(); }
            }, 25);
        });
        child.kill('SIGKILL');
        await new Promise(res => child.on('close', res));
        const after = new ConsentLedger(dir);
        expect(after.get(r.token)?.status).toBe('APPROVED');
        expect(after.consumePermit(r.token, A.principalId, A.conversationId).result).toBe('CONSUMED');
    }, 30000);

    it('restart reconciles expiry as EXPIRED, never as a human rejection', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-expiry-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ expiresAt: Date.now() - 1000 }); // already expired
        ledger.put(r);
        const after = new ConsentLedger(dir);
        const stored = after.get(r.token)!;
        expect(stored.status).toBe('EXPIRED');
        expect(stored.rejectedAt).toBeUndefined();
        expect(after.consumePermit(r.token, A.principalId, A.conversationId).result).toBe('EXPIRED');
        // on-disk truth
        const rows = JSON.parse(readFileSync(join(dir, 'pending-effects.json'), 'utf8')) as ConsentRecord[];
        expect(rows.find(x => x.token === r.token)?.status).toBe('EXPIRED');
    });

    it('reoffer: only EXPIRED, as a NEW token with full provenance; rejections and consumed permits never re-offer', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-reoffer-'));
        const ledger = new ConsentLedger(dir);
        const expired = record({ token: 'EXPTKN', expiresAt: Date.now() - 1000 });
        const rejected = record({ token: 'REJTKN', status: 'REJECTED', rejectedAt: Date.now() });
        const consumed = record({ token: 'CONT KN'.replace(' ', ''), status: 'CONSUMED', consumedAt: Date.now() });
        const active = record({ token: 'ACTTKN' });
        ledger.put(expired); ledger.put(rejected); ledger.put(consumed); ledger.put(active);

        const re = ledger.reoffer('EXPTKN', { token: 'NEWTKN', expiresAt: Date.now() + 60_000 });
        expect(re).toMatchObject({ ok: true });
        if (re.ok) {
            expect(re.record.status).toBe('PENDING');
            expect(re.record.reofferOf).toBe('EXPTKN');
            expect(re.record.reofferCount).toBe(1);
            expect(re.record.token).toBe('NEWTKN');
            expect(ledger.get('EXPTKN')?.status).toBe('EXPIRED'); // original preserved
        }
        expect(ledger.reoffer('REJTKN', { token: 'X1', expiresAt: 0 })).toMatchObject({ ok: false, reason: 'EXPLICITLY_REJECTED' });
        expect(ledger.reoffer('CONT KN'.replace(' ', ''), { token: 'X2', expiresAt: 0 })).toMatchObject({ ok: false, reason: 'ALREADY_CONSUMED' });
        expect(ledger.reoffer('ACTTKN', { token: 'X3', expiresAt: 0 })).toMatchObject({ ok: false, reason: 'NOT_EXPIRED' });
        expect(ledger.reoffer('MISSING', { token: 'X4', expiresAt: 0 })).toMatchObject({ ok: false, reason: 'UNKNOWN' });
    });

    it('gate level: one approval = one execution across processes; the loser re-pends, the receipt survives', () => {
        // The singleton gate writes into CONFIRMATION_GATE_DIR; consume its
        // approved record through a second ledger instance ("other process").
        const args = { to: 'race@fixture.invalid', subject: 'Carrera', body: 'c' };
        const d1 = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        expect(d1.action).toBe('PENDING');
        if (d1.action !== 'PENDING') return;
        confirmationGate.handleUserCommand(`CONFIRMAR ${d1.pending.token}`, A.principalId, A.conversationId);
        const otherProcess = new ConsentLedger(process.env.CONFIRMATION_GATE_DIR!);
        expect(otherProcess.consumePermit(d1.pending.token, A.principalId, A.conversationId).result).toBe('CONSUMED');
        // The concurrent loser gets NO execution: its identical call becomes
        // a brand-new pending that needs its own explicit confirmation.
        const d2 = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        expect(d2.action).toBe('PENDING');
        if (d2.action === 'PENDING') expect(d2.pending.token).not.toBe(d1.pending.token);
        // The receipt of the single execution is durable evidence.
        const stored = otherProcess.get(d1.pending.token);
        expect(stored?.status).toBe('CONSUMED');
        expect(stored?.consumedAt).toBeTypeOf('number');
    });

    it('gate level: expiry is not a rejection and reoffer needs the same principal + conversation', () => {
        const args = { to: 'exp@fixture.invalid', subject: 'Expira', body: 'c' };
        const d1 = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        expect(d1.action).toBe('PENDING');
        if (d1.action !== 'PENDING') return;
        // Force expiry in the store itself.
        const ledger = new ConsentLedger(process.env.CONFIRMATION_GATE_DIR!);
        ledger.update(d1.pending.token, { expiresAt: Date.now() - 1 });
        const ack = confirmationGate.handleUserCommand(`CONFIRMAR ${d1.pending.token}`, A.principalId, A.conversationId);
        expect(ack).toContain('expiró sin decisión');
        expect(ack).not.toContain('rechazada');
        const wrong = confirmationGate.reoffer(d1.pending.token, B.principalId, A.conversationId);
        expect(wrong).toContain('no pertenece');
        const ok = confirmationGate.reoffer(d1.pending.token, A.principalId, A.conversationId);
        expect(ok).toContain('reofrecida');
        expect(ok).toContain('exp@fixture.invalid'); // full summary re-shown
    });
});

describe('R8-H2: REOFRECER is a real wired command, not an unfulfillable invitation', () => {
    it('REOFRECER <token> re-offers an expired action to its own principal only, and the new token executes exactly once', () => {
        const args = { to: 'reoferta@fixture.invalid', subject: 'Reoferta', body: 'c' };
        const d1 = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        expect(d1.action).toBe('PENDING');
        if (d1.action !== 'PENDING') return;
        const ledger = new ConsentLedger(process.env.CONFIRMATION_GATE_DIR!);
        ledger.update(d1.pending.token, { expiresAt: Date.now() - 1 });

        // The expiry ack names the exact, executable command.
        const expiredAck = confirmationGate.handleUserCommand(`CONFIRMAR ${d1.pending.token}`, A.principalId, A.conversationId);
        expect(expiredAck).toContain(`REOFRECER ${d1.pending.token}`);

        // Wrong principal cannot re-offer.
        expect(confirmationGate.handleUserCommand(`REOFRECER ${d1.pending.token}`, B.principalId, A.conversationId)).toContain('no pertenece');

        // Right principal re-offers: new token, full summary re-shown.
        const ack = confirmationGate.handleUserCommand(`REOFRECER ${d1.pending.token}`, A.principalId, A.conversationId);
        expect(ack).toContain('reofrecida');
        expect(ack).toContain('reoferta@fixture.invalid');
        const newToken = ack!.match(/reofrecida como ([A-Z2-9]{6})/)![1];
        expect(newToken).not.toBe(d1.pending.token);

        // The re-offered action awaits its own explicit yes, then executes ONCE.
        expect(confirmationGate.check('send_email', args, A.principalId, A.conversationId).action).toBe('PENDING');
        confirmationGate.handleUserCommand(`CONFIRMAR ${newToken}`, A.principalId, A.conversationId);
        expect(confirmationGate.check('send_email', args, A.principalId, A.conversationId).action).toBe('EXECUTE');
        expect(confirmationGate.check('send_email', args, A.principalId, A.conversationId).action).toBe('PENDING');

        // An explicit rejection is never re-offered.
        const d2 = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        if (d2.action !== 'PENDING') throw new Error('expected PENDING');
        confirmationGate.handleUserCommand(`RECHAZAR ${d2.pending.token}`, A.principalId, A.conversationId);
        expect(confirmationGate.handleUserCommand(`REOFRECER ${d2.pending.token}`, A.principalId, A.conversationId)).toContain('rechazada explícitamente');
    });

    it('wiring guard: the ALREADY_CONSUMED mapping and its truthful message exist (static; the exact race window needs no production seam - the underlying LOST outcome is runtime-proven at ledger level)', () => {
        const gate = readFileSync('services/tools/confirmationGate.ts', 'utf8');
        expect(gate).toContain("if (permit.result === 'LOST') return { action: 'ALREADY_CONSUMED' };");
        expect(gate).toContain("| { action: 'ALREADY_CONSUMED' }");
        expect(gate).not.toContain("permit.result !== 'EXPIRED') return { action: 'BLOCKED_NO_PRINCIPAL' }");
        const chat = readFileSync('services/chatToolIntegration.ts', 'utf8');
        expect(chat).toContain("decision.action === 'ALREADY_CONSUMED'");
        expect(chat).toContain('PERMIT_CONSUMED_UNCONFIRMED');
        expect(chat).not.toContain('ya fue ejecutada por otra llamada');
    });
});
