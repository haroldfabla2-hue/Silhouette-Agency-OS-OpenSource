import type { Host, HostReport } from '../services/lifecycle/host';

// Source-fixed bootstrap/root bridge. No implicit host or application selector.
let stopInstalledHost: (() => Promise<HostReport>) | undefined;
export function installRuntimeRootHost(host: Host): void {
    if (stopInstalledHost) throw new Error('Runtime root host already installed');
    stopInstalledHost = () => host.stop();
}
export function stopRuntimeRootHost(): Promise<HostReport> {
    if (!stopInstalledHost) throw new Error('Explicit runtime bootstrap must precede server entry');
    return stopInstalledHost();
}
