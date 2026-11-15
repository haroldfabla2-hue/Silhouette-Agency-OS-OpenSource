import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export interface TemporalClaim {
    id: string; subject: string; predicate: string; object: string; polarity: boolean;
    validFrom: number; validTo?: number; observedAt: number; sourceIds: string[];
    confidence: number; ownerId: string; state: 'PROPOSED' | 'CONFIRMED' | 'CONFLICTED' | 'SUPERSEDED';
    supersedes?: string;
}
export interface Procedure {
    id: string; version: number; ownerId: string; sourceIds: string[]; preconditions: string[];
    steps: string[]; postconditions: string[]; context: string; successfulRuns: number;
    failedRuns: number; state: 'PROPOSED' | 'TESTED' | 'APPROVED' | 'REVOKED';
    previousVersion?: number;
}
interface EvidenceState { schema: 1; claims: TemporalClaim[]; procedures: Procedure[] }
/** Evidence registry stores explicit assertions, never infers truth from co-mentions. */
export class MemoryEvidence {
    private queue: Promise<void> = Promise.resolve();
    constructor(private readonly directory: string) {}
    private async read(): Promise<EvidenceState> {
        try { return JSON.parse(await readFile(join(this.directory, 'evidence.json'), 'utf8')); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, claims: [], procedures: [] }; throw e; }
    }
    private update<T>(operation: (state: EvidenceState) => T): Promise<T> {
        const run = this.queue.then(async () => {
            const state = await this.read();
            const result = operation(state);
            await mkdir(this.directory, { recursive: true });
            const temp = join(this.directory, 'evidence.json.tmp');
            await writeFile(temp, JSON.stringify(state), 'utf8');
            await rename(temp, join(this.directory, 'evidence.json'));
            return result;
        });
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
    public async proposeClaim(claim: Omit<TemporalClaim, 'id' | 'state'>, knownSourceIds: string[]): Promise<TemporalClaim> {
        if (!claim.subject || !claim.predicate || !claim.object || !claim.ownerId || !claim.sourceIds.length
            || claim.sourceIds.some(id => !knownSourceIds.includes(id)) || !Number.isFinite(claim.validFrom)
            || !Number.isFinite(claim.observedAt) || (claim.validTo !== undefined && claim.validTo <= claim.validFrom)
            || claim.confidence < 0 || claim.confidence > 1) throw new Error('Invalid or unsupported temporal claim');
        return this.update(state => {
            const id = createHash('sha256').update(JSON.stringify(claim)).digest('hex');
            const existing = state.claims.find(c => c.id === id);
            if (existing) return existing;
            const proposed: TemporalClaim = { ...claim, id, state: 'PROPOSED' };
            for (const prior of state.claims.filter(c => c.ownerId === claim.ownerId && c.subject === claim.subject && c.predicate === claim.predicate)) {
                const overlaps = prior.validFrom < (claim.validTo ?? Infinity) && claim.validFrom < (prior.validTo ?? Infinity);
                if (overlaps && (prior.object !== claim.object || prior.polarity !== claim.polarity)) {
                    proposed.state = 'CONFLICTED';
                    prior.state = 'CONFLICTED';
                } else if (!overlaps && prior.validTo !== undefined && prior.validTo <= claim.validFrom) {
                    proposed.supersedes = prior.id; // Temporal succession, not truth confirmation.
                }
            }
            state.claims.push(proposed);
            return proposed;
        });
    }
    public async claimsAt(ownerId: string, at: number): Promise<TemporalClaim[]> {
        await this.queue;
        return (await this.read()).claims.filter(c => c.ownerId === ownerId && c.validFrom <= at && (c.validTo === undefined || at < c.validTo));
    }
    public async proposeProcedure(procedure: Omit<Procedure, 'state' | 'successfulRuns' | 'failedRuns'>, knownExecutionIds: string[]): Promise<Procedure> {
        if (!procedure.id || !procedure.ownerId || procedure.version < 1 || !procedure.steps.length || !procedure.preconditions.length
            || !procedure.postconditions.length || !procedure.sourceIds.length || procedure.sourceIds.some(id => !knownExecutionIds.includes(id))) {
            throw new Error('Procedure requires actual execution evidence and contracts');
        }
        return this.update(state => {
            if (state.procedures.some(p => p.id === procedure.id && p.version === procedure.version)) throw new Error('Immutable procedure version already exists');
            const proposed: Procedure = { ...procedure, state: 'PROPOSED', successfulRuns: 0, failedRuns: 0 };
            state.procedures.push(proposed);
            return proposed;
        });
    }
    public async recordProcedureOutcome(id: string, version: number, ownerId: string, succeeded: boolean): Promise<void> {
        await this.update(state => {
            const procedure = state.procedures.find(p => p.id === id && p.version === version && p.ownerId === ownerId);
            if (!procedure) throw new Error('Missing procedure');
            if (succeeded) { procedure.successfulRuns++; if (procedure.state === 'PROPOSED') procedure.state = 'TESTED'; }
            else { procedure.failedRuns++; procedure.state = 'REVOKED'; }
        });
    }
    /** Approval must come from the caller's authenticated human-approval flow, never from model output. */
    public async approveProcedure(id: string, version: number, ownerId: string): Promise<void> {
        await this.update(state => {
            const p = state.procedures.find(p => p.id === id && p.version === version && p.ownerId === ownerId);
            if (!p || p.state !== 'TESTED' || !p.successfulRuns || p.failedRuns) throw new Error('Untested or failed procedure cannot be approved');
            p.state = 'APPROVED';
        });
    }
    public async actionableProcedures(ownerId: string): Promise<Procedure[]> {
        await this.queue;
        return (await this.read()).procedures.filter(p => p.ownerId === ownerId && p.state === 'APPROVED');
    }
}
