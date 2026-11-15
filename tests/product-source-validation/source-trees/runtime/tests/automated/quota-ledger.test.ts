import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { QuotaLedger } from '../../services/quotaLedger';

describe('quotaLedger (PR-K)', () => {
    let dir: string;
    let ledger: QuotaLedger;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-'));
        ledger = new QuotaLedger(path.join(dir, 'ledger.json'));
        delete process.env.QUOTA_DAILY_BUDGET;
    });

    it('counts attempts per provider+model and enforces the budget', () => {
        process.env.QUOTA_DAILY_BUDGET = '3';
        expect(ledger.recordAttempt('gemini', 'm1').allowed).toBe(true);
        expect(ledger.recordAttempt('gemini', 'm1').allowed).toBe(true);
        expect(ledger.recordAttempt('gemini', 'm1').allowed).toBe(true);
        const fourth = ledger.recordAttempt('gemini', 'm1');
        expect(fourth.allowed).toBe(false);
        expect(fourth.used).toBe(4);
        expect(fourth.budget).toBe(3);
    });

    it('budgets are per model (buckets independent)', () => {
        process.env.QUOTA_DAILY_BUDGET = '1';
        ledger.recordAttempt('gemini', 'm1');
        expect(ledger.status('gemini', 'm2').allowed).toBe(true);
    });

    it('per-provider override beats the global budget', () => {
        process.env.QUOTA_DAILY_BUDGET = '1';
        process.env.QUOTA_DAILY_BUDGET_GEMINI = '2';
        ledger.recordAttempt('gemini', 'm1');
        expect(ledger.recordAttempt('gemini', 'm1').allowed).toBe(true);
        delete process.env.QUOTA_DAILY_BUDGET_GEMINI;
    });

    it('a corrupt ledger fails open with the provider 429 as the net', () => {
        fs.writeFileSync(path.join(dir, 'ledger.json'), '{not json');
        const s = ledger.recordAttempt('gemini', 'm1');
        expect(s.allowed).toBe(true);
    });

    it('per-model override beats provider and global budgets', () => {
        process.env.QUOTA_DAILY_BUDGET = '9';
        process.env.QUOTA_DAILY_BUDGET_GEMINI = '7';
        process.env.QUOTA_DAILY_BUDGET_GEMINI_GEMINI_3_8_FLASH = '2';
        expect(ledger.recordAttempt('gemini', 'gemini-3.8-flash').budget).toBe(2);
        ledger.recordAttempt('gemini', 'gemini-3.8-flash');
        expect(ledger.recordAttempt('gemini', 'gemini-3.8-flash').allowed).toBe(false);
        // the same provider with another model uses the provider budget
        expect(ledger.recordAttempt('gemini', 'gemini-3.1-flash-lite').budget).toBe(7);
        delete process.env.QUOTA_DAILY_BUDGET_GEMINI;
        delete process.env.QUOTA_DAILY_BUDGET_GEMINI_GEMINI_3_8_FLASH;
    });

    it('prunes old day keys', () => {
        fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify({ '2020-01-01:gemini:m1': 999 }));
        ledger.recordAttempt('gemini', 'm1');
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf-8'));
        expect(Object.keys(data).some(k => k.startsWith('2020-01-01'))).toBe(false);
    });
});
