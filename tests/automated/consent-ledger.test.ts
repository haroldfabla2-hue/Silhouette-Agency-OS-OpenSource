/** Durable consent ledger (R8): real on-disk store, real cross-process
 * locking, real child processes killed with SIGKILL. Two independent
 * fixture principals (not real people). No provider/model call.
 * DECLARED DOUBLES: child processes are tsx runners of the real ledger
 * module, not production servers. DECLARED LIMITS: same-host store; the
 * lock file is not a boundary against an attacker with the executor's OS
 * user (infrastructure work, not claimed). */
import { describe, it, expect } from 'vitest';
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
        // on-disk truth: the append-only event log holds the record with its
        // (past) expiry; EXPIRED is the reconciled read-side view, never a
        // stored human rejection
        const lines = readFileSync(join(dir, 'consent-ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
        const put = lines.find(ev => ev.op === 'PUT' && ev.rec.token === r.token);
        expect(put).toBeDefined();
        expect(put.rec.status).toBe('PENDING');
        expect(put.rec.expiresAt).toBeLessThanOrEqual(Date.now());
        expect(lines.some(ev => ev.rec?.rejectedAt || ev.patch?.rejectedAt)).toBe(false);
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
        expect(gate).toContain("if (permit.result === 'LOST') return { action: 'ALREADY_CONSUMED', token: existing.token };");
        expect(gate).toContain("| { action: 'ALREADY_CONSUMED'; token: string }");
        expect(gate).not.toContain("permit.result !== 'EXPIRED') return { action: 'BLOCKED_NO_PRINCIPAL' }");
        const chat = readFileSync('services/chatToolIntegration.ts', 'utf8');
        expect(chat).toContain("decision.action === 'ALREADY_CONSUMED'");
        expect(chat).toContain('PERMIT_CONSUMED_UNCONFIRMED');
        expect(chat).not.toContain('ya fue ejecutada por otra llamada');
    });
});

describe('R8-eventlog: append-only store semantics (H3-root fix on the ledger)', () => {
    it('a torn line (crash mid-append) is skipped and never blocks later truth', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-torn-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        appendFileSync(join(dir, 'consent-ledger.jsonl'), '{"op":"CONSUME","token":"TO');
        const res = new ConsentLedger(dir).consumePermit(r.token, A.principalId, A.conversationId);
        expect(res.result).toBe('CONSUMED');
        expect(new ConsentLedger(dir).consumePermit(r.token, A.principalId, A.conversationId).result).toBe('LOST');
    });

    it('two processes racing to re-offer the same expired token produce exactly ONE new pending (the pre-eventlog code minted two)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-reoffer-race-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ expiresAt: Date.now() - 1 });
        ledger.put(r);
        const runReoffer = (newToken: string) => new Promise<any>((resolve, reject) => {
            const child = spawn(process.execPath, ['--import', 'tsx/esm', 'tests/fixtures/consent-ledger-child.ts',
                dir, r.token, A.principalId, A.conversationId, 'reoffer', newToken], { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            child.stdout.on('data', d => { out += d.toString(); });
            child.on('close', () => {
                try { resolve(JSON.parse(out.trim().split('\n').pop()!)); } catch (e) { reject(e); }
            });
            child.on('error', reject);
        });
        const [r1, r2] = await Promise.all([runReoffer('NTOK1A'), runReoffer('NTOK1B')]);
        const wins = [r1, r2].filter(x => x.ok === true);
        const losses = [r1, r2].filter(x => x.ok === false);
        expect(wins).toHaveLength(1);
        expect(losses).toHaveLength(1);
        expect(losses[0].reason).toBe('ALREADY_REOFFERED');
        // exactly one new pending exists, and the original is not re-offerable again
        const fresh = new ConsentLedger(dir);
        expect(fresh.all().filter(x => x.reofferOf === r.token)).toHaveLength(1);
        expect(fresh.reoffer(r.token, { token: 'NTOK3X', expiresAt: Date.now() + 60_000 })).toMatchObject({ ok: false, reason: 'ALREADY_REOFFERED' });
    }, 30000);

    it('outcome recording: only after consumption, first record wins, never rewritten; the gate reports it truthfully', () => {
        const args = { to: 'outcome@fixture.invalid', subject: 'Outcome', body: 'c' };
        const d = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        if (d.action !== 'PENDING') throw new Error('expected PENDING');
        // no outcome before consumption
        expect(confirmationGate.recordOutcome(d.pending.token, 'nobody', true)).toBe(false);
        confirmationGate.handleUserCommand(`CONFIRMAR ${d.pending.token}`, A.principalId, A.conversationId);
        const exec = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        expect(exec.action).toBe('EXECUTE');
        if (exec.action !== 'EXECUTE') return;
        expect(confirmationGate.recordOutcome(exec.token, exec.receipt, false, 'SMTP rechazado')).toBe(true);
        expect(confirmationGate.recordOutcome(exec.token, exec.receipt, true)).toBe(false); // never rewritten
        expect(confirmationGate.recordOutcome(exec.token, 'not-the-winner', true)).toBe(false); // only the permit winner reports
        const ack = confirmationGate.handleUserCommand(`CONFIRMAR ${d.pending.token}`, A.principalId, A.conversationId);
        expect(ack).toContain('FALLO de ejecución');
        expect(ack).toContain('SMTP rechazado');
        // unknown outcome says unknown, never "executed"
        const args2 = { ...args, subject: 'Outcome 2' };
        const d2 = confirmationGate.check('send_email', args2, A.principalId, A.conversationId);
        if (d2.action !== 'PENDING') throw new Error('expected PENDING');
        confirmationGate.handleUserCommand(`CONFIRMAR ${d2.pending.token}`, A.principalId, A.conversationId);
        confirmationGate.check('send_email', args2, A.principalId, A.conversationId);
        const ack2 = confirmationGate.handleUserCommand(`CONFIRMAR ${d2.pending.token}`, A.principalId, A.conversationId);
        expect(ack2).toContain('sin resultado registrado');
        expect(ack2).not.toContain('ejecutada una vez');
    });
});

describe('R8-v3: adversarial store transitions (review findings 1-5, 7)', () => {
    it('REJECTED is terminal: a later CONFIRMAR never overrides it, and no permit is minted', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-terminal-'));
        const ledger = new ConsentLedger(dir);
        const r = record({});
        ledger.put(r);
        expect(ledger.decide(r.token, 'REJECTED', A.principalId, A.conversationId)?.status).toBe('REJECTED');
        expect(ledger.decide(r.token, 'APPROVED', A.principalId, A.conversationId)?.status).toBe('REJECTED');
        expect(ledger.consumePermit(r.token, A.principalId, A.conversationId).result).toBe('NOT_APPROVED');
    });

    it('decision races: two processes, CONFIRMAR vs RECHAZAR - exactly one decision stands and the state never contradicts the receipt', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-decide-race-'));
        const ledger = new ConsentLedger(dir);
        const r = record({});
        ledger.put(r);
        const runDecide = (decision: string) => new Promise<any>((resolve, reject) => {
            const child = spawn(process.execPath, ['--import', 'tsx/esm', 'tests/fixtures/consent-ledger-child.ts',
                dir, r.token, A.principalId, A.conversationId, 'decide', decision], { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            child.stdout.on('data', d => { out += d.toString(); });
            child.on('close', () => {
                try { resolve(JSON.parse(out.trim().split('\n').pop()!)); } catch (e) { reject(e); }
            });
            child.on('error', reject);
        });
        const [a, b] = await Promise.all([runDecide('APPROVED'), runDecide('REJECTED')]);
        const finalStatus = new ConsentLedger(dir).get(r.token)!.status;
        expect([a.status, b.status]).toContain(finalStatus);
        expect(['APPROVED', 'REJECTED']).toContain(finalStatus);
        if (finalStatus === 'REJECTED') {
            expect(ledger.decide(r.token, 'APPROVED', A.principalId, A.conversationId)?.status).toBe('REJECTED');
        }
    }, 30000);

    it('RECHAZAR after a valid CONSUME does not rewrite the record: it stays CONSUMED with its receipt and outcome', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-consume-then-reject-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        const won = ledger.consumePermit(r.token, A.principalId, A.conversationId);
        if (won.result !== 'CONSUMED') throw new Error('expected CONSUMED');
        expect(ledger.recordOutcome(r.token, won.record.consumedBy!, 'EXECUTOR_OK')).toBe(true);
        const after = ledger.decide(r.token, 'REJECTED', A.principalId, A.conversationId)!;
        expect(after.status).toBe('CONSUMED');
        expect(after.consumedBy).toBe(won.record.consumedBy);
        expect(after.outcome?.status).toBe('EXECUTOR_OK');
    });

    it('a duplicate PUT never resurrects a decided/consumed record (first-wins)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-put-firstwins-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        ledger.consumePermit(r.token, A.principalId, A.conversationId);
        ledger.put({ ...r, status: 'PENDING', consumedBy: undefined, consumedAt: undefined, args: { to: 'attacker@fixture.invalid' } });
        const after = ledger.get(r.token)!;
        expect(after.status).toBe('CONSUMED');
        expect(after.args.to).toBe('x@fixture.invalid');
    });

    it('migration resumes after a crash mid-import and never duplicates (PUT first-wins)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-migration-'));
        // legacy store with two records, one already CONSUMED
        const consumed = record({ token: 'LEGAC1', status: 'CONSUMED', consumedAt: Date.now(), consumedBy: 'old:abc' });
        const pending = record({ token: 'LEGAC2' });
        writeFileSync(join(dir, 'pending-effects.json'), JSON.stringify([consumed, pending]));
        // simulated crashed earlier import: LEGAC1 already imported, legacy not renamed
        appendFileSync(join(dir, 'consent-ledger.jsonl'), JSON.stringify({ op: 'PUT', rec: consumed }) + '\n');
        const ledger = new ConsentLedger(dir);
        const all = ledger.all();
        expect(all.filter(x => x.token === 'LEGAC1')).toHaveLength(1);
        expect(all.find(x => x.token === 'LEGAC1')?.status).toBe('CONSUMED');
        expect(all.find(x => x.token === 'LEGAC2')?.status).toBe('PENDING');
        expect(existsSync(join(dir, 'pending-effects.json'))).toBe(false);
        expect(existsSync(join(dir, 'pending-effects.json.imported'))).toBe(true);
        // the consumed legacy permit does not re-arm
        expect(ledger.consumePermit('LEGAC1', A.principalId, A.conversationId).result).toBe('LOST');
    });

    it('a read failure THROWS (fail-closed), never a silent empty store', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-readfail-'));
        const ledger = new ConsentLedger(dir);
        ledger.put(record({}));
        chmodSync(join(dir, 'consent-ledger.jsonl'), 0o000);
        expect(() => new ConsentLedger(dir).all()).toThrow();
        chmodSync(join(dir, 'consent-ledger.jsonl'), 0o600);
    });

    it('an instance sees another instance\'s appends via incremental tail reads (no full re-parse)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-incremental-'));
        const a1 = new ConsentLedger(dir);
        const a2 = new ConsentLedger(dir);
        a1.put(record({ token: 'INCR01' }));
        a1.put(record({ token: 'INCR02' }));
        expect(a2.get('INCR01')).toBeDefined(); // first tail read
        a1.put(record({ token: 'INCR03' }));
        const after = a2.all().map(x => x.token);
        expect(after).toContain('INCR03'); // second read folds only the new tail
    });

    it('outcome binding: a non-winner receipt can never record the outcome', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consent-outcome-bind-'));
        const ledger = new ConsentLedger(dir);
        const r = record({ status: 'APPROVED', approvedAt: Date.now() });
        ledger.put(r);
        const won = ledger.consumePermit(r.token, A.principalId, A.conversationId);
        if (won.result !== 'CONSUMED') throw new Error('expected CONSUMED');
        expect(ledger.recordOutcome(r.token, 'someone-else', false, 'mentira')).toBe(false);
        expect(ledger.get(r.token)!.outcome).toBeUndefined();
        expect(ledger.recordOutcome(r.token, won.record.consumedBy!, false, 'falló de verdad')).toBe(true);
        expect(ledger.get(r.token)!.outcome?.detail).toBe('falló de verdad');
    });

    it('gate: a CONFIRMAR that loses a race reports the CURRENT truth, not a false confirmation', () => {
        const args = { to: 'race-truth@fixture.invalid', subject: 'S', body: 'c' };
        const d = confirmationGate.check('send_email', args, A.principalId, A.conversationId);
        if (d.action !== 'PENDING') throw new Error('expected PENDING');
        // reject first (terminal), then a late CONFIRMAR must not claim success
        confirmationGate.handleUserCommand(`RECHAZAR ${d.pending.token}`, A.principalId, A.conversationId);
        // pre-check path: the entry is already REJECTED, so the gate reports
        // that truth directly; the decide() race path is covered by the
        // cross-process decision-race test above.
        const late = confirmationGate.handleUserCommand(`CONFIRMAR ${d.pending.token}`, A.principalId, A.conversationId);
        expect(late).toContain('ya fue rechazada antes');
        expect(confirmationGate.check('send_email', args, A.principalId, A.conversationId).action).toBe('REJECTED');
    });
});
