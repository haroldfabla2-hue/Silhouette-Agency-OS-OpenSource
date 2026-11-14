import { runtimeSqliteAdmission, runSqliteOperation } from './sqliteAdmission';

/** The production controller's exact recurring poll owner. Refresh is the real
 * controller callback. No provider, storage replacement, timer virtualization,
 * final flush or admission exception suppression is implemented here.
 */
export class SystemTelemetryPoll {
    private isPolling = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private owner: Promise<void> | undefined;
    private stopOwner: Promise<void> | undefined;
    private failure: { error: unknown } | undefined;

    constructor(private readonly refresh: () => Promise<unknown>) {
        runtimeSqliteAdmission().onSealStopProducer(() => this.sealProducer());
    }
    sealProducer(): void {
        this.isPolling = false;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }
    start(): void {
        return runSqliteOperation('server/controllers/systemController.ts:startBackgroundPolling', () => {
            if (this.isPolling || this.stopOwner) return;
            this.isPolling = true;
            this.admitPoll();
        });
    }
    private admitPoll(): void {
        if (!this.isPolling) return;
        return runSqliteOperation('server/controllers/systemController.ts:admitTelemetryPoll', () => {
            if (!this.isPolling) return;
            this.timer = undefined;
            const owner = this.refresh().then(() => undefined).catch(error => {
                this.failure ??= { error };
                console.error('[TELEMETRY] Background poll failed', error);
                throw error;
            }).finally(() => {
                if (this.isPolling) this.timer = setTimeout(() => this.admitPoll(), 5000);
            });
            this.owner = owner;
            void owner.catch(() => {});
        });
    }
    stop(): Promise<void> {
        if (this.stopOwner) return this.stopOwner;
        this.sealProducer();
        const active = this.owner;
        this.stopOwner = (active ?? Promise.resolve()).then(() => {
            if (this.failure) throw this.failure.error;
        });
        void this.stopOwner.catch(() => {});
        return this.stopOwner;
    }
}
