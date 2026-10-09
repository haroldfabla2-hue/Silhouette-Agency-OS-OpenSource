// =============================================================================
// SILHOUETTE FINANCIAL VAULT & EPHEMERAL VIRTUAL CARD ENGINE (PHASE 22)
// Cryptographically Protected, Single-Use Virtual Payment Cards with Strict
// Spend Ceilings, Merchant Locking, Auto-Destruction, and Hardware Approval Gates.
// =============================================================================

import crypto from 'crypto';
import { sqliteService } from '../sqliteService';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';
import { actionExecutor } from '../actionExecutor';
import { CapabilityState, demoOrUnavailable } from '../security/capabilityState';

export type CardStatus = 'ACTIVE' | 'EXHAUSTED' | 'REVOKED' | 'EXPIRED';

export interface VirtualCard {
    id: string;
    last4: string;
    brand: 'visa' | 'mastercard' | 'amex';
    cardholderName: string;
    expMonth: string;
    expYear: string;
    merchantLock?: string;
    spendLimitCents: number;
    spentCents: number;
    currency: string;
    status: CardStatus;
    purpose: string;
    createdAt: number;
    expiresAt: number;
    /** DEMO = locally generated test number, NOT a real issued card. */
    capabilityState?: CapabilityState;
}

export interface DecryptedCardDetails extends VirtualCard {
    cardNumber: string;
    cvv: string;
}

export interface CreateCardRequest {
    merchant: string;
    maxAmountCents: number;
    purpose: string;
    currency?: string;
    lifespanMinutes?: number;
    requireHumanApproval?: boolean;
}

export interface SpendSummary {
    todaySpentCents: number;
    dailyLimitCents: number;
    activeCardsCount: number;
    currency: string;
}

export class FinancialVault {
    /** Resolved lazily from the environment (no hardcoded default). Derivation unchanged for stored-card compatibility. */
    private get encryptionKey(): Buffer | null {
        const seed = process.env.FINANCIAL_VAULT_KEY || process.env.SYSTEM_SECRET;
        return seed ? crypto.createHash('sha256').update(seed).digest() : null;
    }
    private readonly defaultDailyLimitCents = 50000; // $500.00 default daily ceiling
    private isInitialized = false;

    constructor() {
        this.initializeSchema();
    }

    /**
     * Initializes tables in SQLite for cards and transactions.
     */
    private initializeSchema(): void {
        if (this.isInitialized) return;

        sqliteService.db.exec(`
            CREATE TABLE IF NOT EXISTS financial_cards (
                id TEXT PRIMARY KEY,
                last4 TEXT NOT NULL,
                brand TEXT NOT NULL,
                cardholder_name TEXT NOT NULL,
                exp_month TEXT NOT NULL,
                exp_year TEXT NOT NULL,
                encrypted_number TEXT NOT NULL,
                encrypted_cvv TEXT NOT NULL,
                iv TEXT NOT NULL,
                auth_tag TEXT NOT NULL,
                merchant_lock TEXT,
                spend_limit_cents INTEGER NOT NULL,
                spent_cents INTEGER DEFAULT 0,
                currency TEXT DEFAULT 'USD',
                status TEXT NOT NULL,
                purpose TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS financial_transactions (
                id TEXT PRIMARY KEY,
                card_id TEXT NOT NULL,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                currency TEXT DEFAULT 'USD',
                status TEXT NOT NULL,
                purpose TEXT,
                receipt_signature TEXT,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (card_id) REFERENCES financial_cards(id)
            );

            CREATE INDEX IF NOT EXISTS idx_cards_status ON financial_cards(status);
            CREATE INDEX IF NOT EXISTS idx_trans_card ON financial_transactions(card_id);
        `);

        // Migration: idempotency key for spend reservations (safe on existing databases)
        const cols = sqliteService.db.prepare(`PRAGMA table_info(financial_transactions)`).all() as any[];
        if (!cols.some(c => c.name === 'idempotency_key')) {
            sqliteService.db.exec(`ALTER TABLE financial_transactions ADD COLUMN idempotency_key TEXT`);
        }
        sqliteService.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trans_idem ON financial_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL`);

        this.isInitialized = true;
    }

    /**
     * Encrypts card sensitive data using AES-256-GCM.
     */
    private requireKey(): Buffer {
        if (!this.encryptionKey) throw new Error('VAULT_KEY_MISSING: set FINANCIAL_VAULT_KEY (no default key is used)');
        return this.encryptionKey;
    }

    private encrypt(plainText: string): { cipherText: string; iv: string; authTag: string } {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.requireKey(), iv);
        let encrypted = cipher.update(plainText, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return {
            cipherText: encrypted,
            iv: iv.toString('hex'),
            authTag
        };
    }

    /**
     * Decrypts card data using AES-256-GCM.
     */
    private decrypt(cipherText: string, ivHex: string, authTagHex: string): string {
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.requireKey(), Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        let decrypted = decipher.update(cipherText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    /**
     * Requests the issuance of a new single-use virtual card.
     * Enforces daily ceilings and triggers Human-in-the-Loop approval if required.
     */
    public async requestVirtualCard(request: CreateCardRequest): Promise<{ card?: VirtualCard; error?: string; approvalRequired?: boolean; capabilityState?: CapabilityState }> {
        this.initializeSchema();

        // 0. Truthfulness gate: no card issuer integration exists yet, so a card can only be
        //    minted in explicit DEMO mode. Otherwise the capability is UNAVAILABLE (never fake success).
        if (!this.encryptionKey) {
            return { error: 'Vault key not configured (FINANCIAL_VAULT_KEY). No default key is used.', capabilityState: 'UNAVAILABLE' };
        }
        const cap = demoOrUnavailable('Virtual card issuing');
        if (cap.state !== 'DEMO') {
            return { error: cap.reason, capabilityState: cap.state };
        }

        // 1. Check daily budget ceiling
        const summary = this.getSpendSummary(request.currency || 'USD');
        if (summary.todaySpentCents + request.maxAmountCents > summary.dailyLimitCents) {
            return {
                error: `Spending limit exceeded. Requested $${(request.maxAmountCents / 100).toFixed(2)}, but only $${((summary.dailyLimitCents - summary.todaySpentCents) / 100).toFixed(2)} remains in today's ceiling.`
            };
        }

        // 2. Human-in-the-loop Gate (Critical Risk)
        const requireApproval = request.requireHumanApproval ?? true;
        if (requireApproval) {
            const approved = await actionExecutor.requestConfirmation({
                id: crypto.randomUUID(),
                type: 'EXECUTE_PAYMENT' as any,
                agentId: 'financial-vault',
                payload: {
                    merchant: request.merchant,
                    amountCents: request.maxAmountCents,
                    purpose: request.purpose
                } as any,
                status: 'PENDING' as any,
                requiresApproval: true,
                timestamp: Date.now()
            }, `Issue Virtual Card of max $${(request.maxAmountCents / 100).toFixed(2)} for merchant "${request.merchant}" (${request.purpose})`);

            if (!approved) {
                systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
                    service: 'FinancialVault',
                    event: 'VCARD_REQUEST_REJECTED_BY_USER',
                    merchant: request.merchant,
                    amount: request.maxAmountCents
                });
                return { error: 'Virtual Card generation rejected by user policy.' };
            }
        }

        // 3. Mint ephemeral card (Supports test sandbox generation with Luhn valid numbers)
        const cardId = `vcard_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
        const testCardNumber = this.generateLuhnTestCard();
        const testCvv = Math.floor(100 + Math.random() * 900).toString();
        const now = new Date();
        const expMonth = String((now.getMonth() + 1)).padStart(2, '0');
        const expYear = String(now.getFullYear() + 2).slice(-2);
        const lifespan = (request.lifespanMinutes || 30) * 60 * 1000;
        const expiresAt = Date.now() + lifespan;

        const payload = JSON.stringify({ cardNumber: testCardNumber, cvv: testCvv });
        const encPayload = this.encrypt(payload);

        const cardholderName = 'SILHOUETTE OS AGENT';
        const last4 = testCardNumber.slice(-4);
        const brand = 'visa';

        sqliteService.db.prepare(`
            INSERT INTO financial_cards (
                id, last4, brand, cardholder_name, exp_month, exp_year,
                encrypted_number, encrypted_cvv, iv, auth_tag,
                merchant_lock, spend_limit_cents, spent_cents, currency,
                status, purpose, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            cardId,
            last4,
            brand,
            cardholderName,
            expMonth,
            expYear,
            encPayload.cipherText,
            '',
            encPayload.iv,
            encPayload.authTag,
            request.merchant.toLowerCase(),
            request.maxAmountCents,
            0,
            request.currency || 'USD',
            'ACTIVE',
            request.purpose,
            Date.now(),
            expiresAt
        );

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'FinancialVault',
            event: 'VCARD_ISSUED',
            cardId,
            merchant: request.merchant,
            limitCents: request.maxAmountCents,
            last4
        });

        const createdCard: VirtualCard = {
            id: cardId,
            last4,
            brand,
            cardholderName,
            expMonth,
            expYear,
            merchantLock: request.merchant.toLowerCase(),
            spendLimitCents: request.maxAmountCents,
            spentCents: 0,
            currency: request.currency || 'USD',
            status: 'ACTIVE',
            purpose: request.purpose,
            createdAt: Date.now(),
            expiresAt,
            capabilityState: 'DEMO'
        };

        return { card: createdCard, capabilityState: 'DEMO' };
    }

    /**
     * Safely retrieves full decrypted card details strictly for browser checkout autofill.
     * Card details are never persisted in plain text logs.
     */
    public getCardForAutofill(cardId: string): DecryptedCardDetails | null {
        this.initializeSchema();

        const row = sqliteService.db.prepare(`
            SELECT * FROM financial_cards WHERE id = ? AND status = 'ACTIVE'
        `).get(cardId) as any;

        if (!row) return null;

        if (Date.now() > row.expires_at) {
            this.burnCard(cardId, 'EXPIRED');
            return null;
        }

        const rawJson = this.decrypt(row.encrypted_number, row.iv, row.auth_tag);
        const { cardNumber, cvv } = JSON.parse(rawJson);

        return {
            id: row.id,
            last4: row.last4,
            brand: row.brand,
            cardholderName: row.cardholder_name,
            expMonth: row.exp_month,
            expYear: row.exp_year,
            merchantLock: row.merchant_lock,
            spendLimitCents: row.spend_limit_cents,
            spentCents: row.spent_cents,
            currency: row.currency,
            status: row.status,
            purpose: row.purpose,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            cardNumber,
            cvv
        };
    }

    /** Normalizes a merchant or URL to a comparable lowercase host-ish key. */
    private normalizeMerchant(m: string): string {
        const t = (m || '').trim().toLowerCase();
        try { return new URL(t.includes('://') ? t : `https://${t}`).hostname.replace(/^www\./, ''); }
        catch { return t.replace(/^www\./, ''); }
    }

    /**
     * Atomically RESERVES spend (PENDING). All checks and the insert happen in one SQLite
     * transaction: card must exist, be ACTIVE and unexpired; merchant must match the lock; currency must
     * match the card; the amount must be a positive integer; card limit and the per-currency daily ceiling
     * count PENDING + COMPLETED. Idempotent on idempotencyKey (a repeat returns the same reservation).
     */
    public reserveSpend(p: { cardId: string; merchant: string; amountCents: number; currency?: string; idempotencyKey: string; purpose?: string }):
        { ok: true; txId: string; replayed?: boolean } | { ok: false; reason: string } {
        this.initializeSchema();
        if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
        if (!p.idempotencyKey) return { ok: false, reason: 'IDEMPOTENCY_KEY_REQUIRED' };
        const db = sqliteService.db;
        const run = db.transaction((): { ok: true; txId: string; replayed?: boolean } | { ok: false; reason: string } => {
            const prior = db.prepare(`SELECT id, card_id, amount_cents FROM financial_transactions WHERE idempotency_key = ?`).get(p.idempotencyKey) as any;
            if (prior) {
                if (prior.card_id !== p.cardId || prior.amount_cents !== p.amountCents) return { ok: false, reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' };
                return { ok: true, txId: prior.id, replayed: true };
            }
            const card = db.prepare(`SELECT * FROM financial_cards WHERE id = ?`).get(p.cardId) as any;
            if (!card) return { ok: false, reason: 'CARD_NOT_FOUND' };
            if (card.status !== 'ACTIVE') return { ok: false, reason: `CARD_${card.status}` };
            if (Date.now() > card.expires_at) return { ok: false, reason: 'CARD_EXPIRED' };
            const cur = (p.currency || card.currency || 'USD').toUpperCase();
            if (cur !== String(card.currency).toUpperCase()) return { ok: false, reason: 'CURRENCY_MISMATCH' };
            if (card.merchant_lock && this.normalizeMerchant(card.merchant_lock) !== this.normalizeMerchant(p.merchant)) return { ok: false, reason: 'MERCHANT_MISMATCH' };
            const committed = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM financial_transactions WHERE card_id = ? AND status IN ('PENDING','COMPLETED')`).get(p.cardId) as any).t;
            if (committed + p.amountCents > card.spend_limit_cents) return { ok: false, reason: 'CARD_LIMIT_EXCEEDED' };
            const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
            const day = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM financial_transactions WHERE timestamp >= ? AND currency = ? AND status IN ('PENDING','COMPLETED')`).get(startOfDay.getTime(), cur) as any).t;
            if (day + p.amountCents > this.defaultDailyLimitCents) return { ok: false, reason: 'DAILY_LIMIT_EXCEEDED' };
            const txId = `tx_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
            db.prepare(`INSERT INTO financial_transactions (id, card_id, merchant, amount_cents, currency, status, purpose, receipt_signature, timestamp, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?)`)
                .run(txId, p.cardId, p.merchant, p.amountCents, cur, 'PENDING', p.purpose || card.purpose, null, Date.now(), p.idempotencyKey);
            return { ok: true, txId };
        });
        const r = run();
        if (r.ok && !r.replayed) {
            systemBus.emit(SystemProtocol.TELEMETRY_LOG, { service: 'FinancialVault', event: 'SPEND_RESERVED', txId: r.txId, cardId: p.cardId, amountCents: p.amountCents });
        }
        return r;
    }

    /** PENDING -> COMPLETED; updates card spend and burns an exhausted card. */
    public captureSpend(txId: string, receiptSignature?: string): boolean {
        this.initializeSchema();
        const db = sqliteService.db;
        return db.transaction((): boolean => {
            const tx = db.prepare(`SELECT * FROM financial_transactions WHERE id = ? AND status = 'PENDING'`).get(txId) as any;
            if (!tx) return false;
            db.prepare(`UPDATE financial_transactions SET status = 'COMPLETED', receipt_signature = ? WHERE id = ?`).run(receiptSignature || null, txId);
            const card = db.prepare(`SELECT spent_cents, spend_limit_cents FROM financial_cards WHERE id = ?`).get(tx.card_id) as any;
            const newSpent = card.spent_cents + tx.amount_cents;
            db.prepare(`UPDATE financial_cards SET spent_cents = ?, status = CASE WHEN ? >= spend_limit_cents AND status = 'ACTIVE' THEN 'EXHAUSTED' ELSE status END WHERE id = ?`).run(newSpent, newSpent, tx.card_id);
            return true;
        })();
    }

    /** PENDING -> RELEASED (frees the reserved amount). */
    public releaseSpend(txId: string): boolean {
        this.initializeSchema();
        return sqliteService.db.prepare(`UPDATE financial_transactions SET status = 'RELEASED' WHERE id = ? AND status = 'PENDING'`).run(txId).changes > 0;
    }

    /**
     * Records a completed transaction. Now validated: reserve (card active, merchant lock, currency, limits)
     * then capture, atomically per step. Returns false when any rule rejects it (revoked card, wrong
     * merchant, over limit...). Prefer reserveSpend/captureSpend/releaseSpend for real payment flows.
     */
    public recordTransaction(
        cardId: string,
        merchant: string,
        amountCents: number,
        purpose?: string,
        receiptSignature?: string
    ): boolean {
        const r = this.reserveSpend({ cardId, merchant, amountCents, idempotencyKey: `rec_${crypto.randomUUID()}`, purpose });
        if (!r.ok) return false;
        const captured = this.captureSpend(r.txId, receiptSignature);
        if (captured) systemBus.emit(SystemProtocol.TELEMETRY_LOG, { service: 'FinancialVault', event: 'TRANSACTION_RECORDED', txId: r.txId, cardId, amountCents, merchant });
        return captured;
    }

    /**
     * Revokes or burns an active virtual card, rendering it permanently unusable.
     */
    public burnCard(cardId: string, reason: CardStatus = 'REVOKED'): boolean {
        this.initializeSchema();

        const result = sqliteService.db.prepare(`
            UPDATE financial_cards SET status = ? WHERE id = ? AND status = 'ACTIVE'
        `).run(reason, cardId);

        if (result.changes > 0) {
            systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
                service: 'FinancialVault',
                event: 'VCARD_BURNED',
                cardId,
                reason
            });
            return true;
        }

        return false;
    }

    /**
     * Returns current daily spending summary against the safety ceiling.
     */
    public getSpendSummary(currency: string = 'USD'): SpendSummary {
        this.initializeSchema();

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const spentRow = sqliteService.db.prepare(`
            SELECT COALESCE(SUM(amount_cents), 0) as total
            FROM financial_transactions
            WHERE timestamp >= ? AND currency = ? AND status IN ('PENDING','COMPLETED')
        `).get(startOfDay.getTime(), (currency || 'USD').toUpperCase()) as any;

        const activeRow = sqliteService.db.prepare(`
            SELECT COUNT(*) as count FROM financial_cards WHERE status = 'ACTIVE'
        `).get() as any;

        return {
            todaySpentCents: spentRow ? spentRow.total : 0,
            dailyLimitCents: this.defaultDailyLimitCents,
            activeCardsCount: activeRow ? activeRow.count : 0,
            currency
        };
    }

    /**
     * Lists active virtual cards with masked numbers.
     */
    public listCards(): VirtualCard[] {
        this.initializeSchema();

        const rows = sqliteService.db.prepare(`
            SELECT id, last4, brand, cardholder_name, exp_month, exp_year,
                   merchant_lock, spend_limit_cents, spent_cents, currency,
                   status, purpose, created_at, expires_at
            FROM financial_cards ORDER BY created_at DESC LIMIT 50
        `).all() as any[];

        return rows.map(r => ({
            id: r.id,
            last4: r.last4,
            brand: r.brand,
            cardholderName: r.cardholder_name,
            expMonth: r.exp_month,
            expYear: r.exp_year,
            merchantLock: r.merchant_lock,
            spendLimitCents: r.spend_limit_cents,
            spentCents: r.spent_cents,
            currency: r.currency,
            status: r.status,
            purpose: r.purpose,
            createdAt: r.created_at,
            expiresAt: r.expires_at
        }));
    }

    /**
     * Generates a valid Visa test card number adhering to the Luhn algorithm.
     */
    private generateLuhnTestCard(): string {
        // Starts with 4 (Visa) + 14 random digits + checksum
        let num = '4';
        for (let i = 0; i < 14; i++) {
            num += Math.floor(Math.random() * 10).toString();
        }

        // Calculate Luhn check digit
        let sum = 0;
        for (let i = 0; i < num.length; i++) {
            let digit = parseInt(num[num.length - 1 - i], 10);
            if (i % 2 === 0) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
        }

        const checkDigit = (10 - (sum % 10)) % 10;
        return num + checkDigit.toString();
    }
}

export const financialVault = new FinancialVault();
