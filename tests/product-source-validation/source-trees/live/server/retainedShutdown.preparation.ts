import type { Host, HostReport } from '../services/lifecycle/host';

/** Documentary source proposal, NOT connected to server/index.ts.
 * Composition owns the stop handle. Services never receive it.
 * Ingress must be registered from the ORIGINAL initialized server/gateway,
 * not by importing those services while shutdown is in progress.
 */
export function composeRetainedShutdown(host: Host, ingress: {
    sealOriginalIngress(): void;
    originalIngressCompletion(): Promise<void>;
}): () => Promise<HostReport> {
    let task: Promise<HostReport> | undefined;
    return () => {
        if (task) return task;
        let yes!: (report: HostReport) => void;
        let no!: (error: unknown) => void;
        task = new Promise<HostReport>((resolve, reject) => { yes = resolve; no = reject; });
        try { ingress.sealOriginalIngress(); }
        catch (error) { host.failure('server:ingress-seal', error); }
        void (async () => {
            // This is only suitable when the ingress implementation retains
            // its ORIGINAL admitted requests/streams. Closing a listener alone
            // is NOT evidence all request/effect owners settled.
            await ingress.originalIngressCompletion();
            return host.stop();
        })().then(yes, error => {
            host.failure('server:ingress-drain', error);
            host.unknown('server:INGRESS_DRAIN_UNVERIFIED', true);
            // Independent owners still receive the seal request. Unknown work
            // prevents unsafe dependency release in Host.stop.
            void host.stop().then(yes, no);
        });
        return task;
    };
}
