import { ResourceScope, type ScopeReport } from './resourceScope';
export type ApplicationState = 'NEW' | 'STARTING' | 'READY' | 'DEGRADED' | 'QUIESCING' | 'DRAINING' | 'CLOSED' | 'FAILED';
export interface ParticipantReceipt { name: string; required: boolean; state: 'READY' | 'DEGRADED'; detail?: string }
export interface ApplicationComposition<T> {
    /** Must call the ACTUAL production composition, with no alternative test app.
     * All acquisitions register on owner scopes, before awaits. */
    prepare(scope: ResourceScope): Promise<{ application: T; participants: ParticipantReceipt[] }>;
    /** Called ONLY after required preparation returns READY; post-bind resources
     * use the same root owner and their individual receipts remain explicit. */
    listen(application: T, scope: ResourceScope): Promise<void>;
}
/** Inert composition boundary, not wired to app/index until every eager consumer
 * migrates. No method imports product modules or starts work at module import. */
export class ApplicationRuntime<T> {
    private state: ApplicationState = 'NEW';
    private readonly scope = new ResourceScope('application');
    private startTask?: Promise<{ application: T; participants: ParticipantReceipt[] }>;
    private closeTask?: Promise<ScopeReport>;
    private participants: ParticipantReceipt[] = [];
    private startupError?: unknown;
    constructor(private readonly composition: ApplicationComposition<T>) {}
    status() { return { state: this.state, participants: [...this.participants], startupError: this.startupError }; }
    start(): Promise<{ application: T; participants: ParticipantReceipt[] }> {
        if (this.startTask && this.state !== 'CLOSED' && this.state !== 'FAILED' && this.state !== 'QUIESCING' && this.state !== 'DRAINING') return this.startTask;
        if (this.state !== 'NEW') return Promise.reject(new Error('Application runtime is single-use'));
        this.state = 'STARTING';
        this.startTask = this.scope.run('application-start', async () => {
            try {
                const prepared = await this.composition.prepare(this.scope);
                this.participants = prepared.participants;
                this.scope.assertAccepting();
                if (this.participants.some(p => p.required && p.state !== 'READY')) throw new Error('Required startup participant did not become ready');
                await this.composition.listen(prepared.application, this.scope);
                this.scope.assertAccepting();
                this.state = this.participants.some(p => p.state === 'DEGRADED') ? 'DEGRADED' : 'READY';
                return prepared;
            } catch (error) {
                this.scope.recordFailure('startup', error);
                this.startupError = error;
                this.state = 'FAILED';
                // Do not await scope.close() inside its own accepted start task.
                // Schedule teardown after the start receipt settles below.
                throw error;
            }
        });
        void this.startTask.catch(() => { void this.close(); });
        return this.startTask;
    }
    close(): Promise<ScopeReport> {
        if (this.closeTask) return this.closeTask;
        this.state = 'QUIESCING';
        const drainage = this.scope.close(); // Synchronous admission fence.
        this.closeTask = Promise.resolve().then(async () => {
            this.state = 'DRAINING';
            const receipt = await drainage;
            this.state = this.startupError || receipt.state === 'FAILED' ? 'FAILED' : 'CLOSED';
            return receipt;
        });
        return this.closeTask;
    }
}
