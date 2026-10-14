/**
 * Agent Reputation Ledger — append-only record of collaboration FACTS.
 *
 * Design basis (2025-26 frontier, see docs in reputation.ts):
 * the Agent Reputations spec (AgentMesh) separates a non-gameable fact
 * substrate from scoring: "the bureau is an accountant, not a judge". This
 * ledger is the accountant. It records only observable facts — who was asked,
 * who answered, how fast, whether it worked — and is never updated or
 * deleted, exactly like the janitor revision ledger and the identity ledger
 * (append-only JSONL with monotonic seq). Scores live in reputation.ts and
 * are pure functions of this ledger, versioned and recomputable.
 *
 * Invariant inherited from the eternal-memory rule: entries are never
 * mutated or removed. A wrong fact is corrected by appending a later fact,
 * never by rewriting history.
 */

import fs from 'fs';
import path from 'path';

export type ReputationFactType =
    | 'COLLAB_REQUESTED'    // agentId was asked for help (as the helper)
    | 'COLLAB_HELPED'       // agentId answered a help request (success + latency)
    | 'COLLAB_SERVED'       // agentId received help for its own request
    | 'COLLAB_UNROUTABLE'   // agentId's request found no helper
    | 'TASK_COMPLETED'      // agentId finished a normal task (latencyMs = real duration)
    | 'TASK_FAILED'         // agentId's normal task failed (crash / explicit failure marker)
    | 'JANITOR_REVISION'    // a janitor truth revision superseded memories agentId owned
    | 'ESCALATION';         // agentId escalated (or was escalated to) — direction in `role`

export interface ReputationFact {
    seq?: number;             // assigned by the ledger (monotonic per file)
    ts: number;
    type: ReputationFactType;
    agentId: string;          // who the fact is ABOUT
    counterpartId?: string;   // the other party
    context?: string;         // domain/role the collaboration was about (context conditioning)
    success?: boolean;
    latencyMs?: number;
    requestId?: string;
    role?: 'from' | 'to';     // ESCALATION direction
    tenantId?: string;
    reason: string;           // required, never empty — the audit trail
}

export class ReputationLedger {
    constructor(private readonly filePath: string) {}

    append(fact: ReputationFact): void {
        if (!fact.reason?.trim()) throw new Error('Reputation fact requires a non-empty reason');
        if (!fact.agentId?.trim()) throw new Error('Reputation fact requires an agentId');
        const seq = this.nextSeq();
        const line = JSON.stringify({ ...fact, seq });
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.appendFileSync(this.filePath, line + '\n', 'utf-8');
    }

    readAll(): ReputationFact[] {
        try {
            if (!fs.existsSync(this.filePath)) return [];
            return fs.readFileSync(this.filePath, 'utf-8')
                .split('\n')
                .filter(l => l.trim().length > 0)
                .map(l => JSON.parse(l) as ReputationFact);
        } catch {
            return [];
        }
    }

    factsAbout(agentId: string): ReputationFact[] {
        return this.readAll().filter(f => f.agentId === agentId);
    }

    private nextSeq(): number {
        const entries = this.readAll();
        return entries.length === 0 ? 1 : Math.max(...entries.map(e => e.seq ?? 0)) + 1;
    }
}

export const defaultReputationLedgerPath = (): string =>
    path.resolve(process.cwd(), 'data', 'reputation-ledger.jsonl');
