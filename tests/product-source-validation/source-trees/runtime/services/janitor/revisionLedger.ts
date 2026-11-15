/**
 * Janitor Revision Ledger — append-only audit trail for the Truth Evaluation
 * Engine (Janitor v2).
 *
 * Pattern mirrors the identity ledger (services/identity/identityEvolution.ts):
 * every decision the janitor makes — proposal, application, abstention,
 * rejection, error, revert — appends one JSONL entry with full provenance
 * (detector + verifier verdicts). The ledger is the audit trail Alberto
 * reviews; nothing here mutates memory.
 *
 * Safety-critical mapping: this is the "flight data recorder" (aviation) and
 * the immutable journal (banking). Entries are never updated or deleted.
 */

import fs from 'fs';
import path from 'path';

export type JanitorAction = 'EXP' | 'REV' | 'DUP' | 'CON';
export type LedgerEventType =
    | 'PROPOSED'    // dry-run: what the janitor WOULD do
    | 'APPLIED'     // live: meta-truth written, members marked superseded
    | 'ABSTAINED'   // disagreement / low confidence / depth cap — default safe action
    | 'REVERTED'    // unsupersede: a previous marking was rolled back
    | 'ERROR';      // circuit-breaker trip, provider failure, parse failure

export interface ProviderVerdict {
    provider: string;
    model: string;
    action?: JanitorAction;
    confidence?: number;
    agrees?: boolean;
    reason?: string;
}

export interface RevisionLedgerEntry {
    seq?: number;            // assigned by the ledger (monotonic per file)
    ts: number;
    runId: string;
    event: LedgerEventType;
    action?: JanitorAction;
    clusterIds: string[];
    metaTruthId?: string;
    metaTruthContent?: string;
    detector?: ProviderVerdict;
    verifier?: ProviderVerdict | null;
    dryRun: boolean;
    reason: string;          // required, never empty — the audit trail
}

export interface JanitorMetrics {
    totalEntries: number;
    applied: number;
    proposed: number;
    abstained: number;
    reverted: number;
    errors: number;
    abstentionRate: number;      // abstained / (applied + abstained), 0 when no decisions
    lastRunId?: string;
    lastRunTs?: number;
}

export class RevisionLedger {
    constructor(private readonly filePath: string) {}

    append(entry: RevisionLedgerEntry): void {
        if (!entry.reason?.trim()) throw new Error('Ledger entry requires a non-empty reason');
        const seq = this.nextSeq();
        const line = JSON.stringify({ ...entry, seq });
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.appendFileSync(this.filePath, line + '\n', 'utf-8');
    }

    readAll(): RevisionLedgerEntry[] {
        try {
            if (!fs.existsSync(this.filePath)) return [];
            return fs.readFileSync(this.filePath, 'utf-8')
                .split('\n')
                .filter(l => l.trim().length > 0)
                .map(l => JSON.parse(l) as RevisionLedgerEntry);
        } catch {
            return [];
        }
    }

    metrics(): JanitorMetrics {
        const entries = this.readAll();
        const count = (e: LedgerEventType) => entries.filter(x => x.event === e).length;
        const applied = count('APPLIED');
        const abstained = count('ABSTAINED');
        const decisions = applied + abstained;
        const last = entries[entries.length - 1];
        return {
            totalEntries: entries.length,
            applied,
            proposed: count('PROPOSED'),
            abstained,
            reverted: count('REVERTED'),
            errors: count('ERROR'),
            abstentionRate: decisions > 0 ? abstained / decisions : 0,
            lastRunId: last?.runId,
            lastRunTs: last?.ts
        };
    }

    private nextSeq(): number {
        const entries = this.readAll();
        return entries.length === 0 ? 1 : Math.max(...entries.map(e => e.seq ?? 0)) + 1;
    }
}

export const defaultLedgerPath = (): string =>
    path.resolve(process.cwd(), 'data', 'janitor-ledger.jsonl');
