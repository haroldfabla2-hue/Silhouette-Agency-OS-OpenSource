import type { Host, HostReport, HostStopProgress } from '../services/lifecycle/host';

// Source-fixed bootstrap/root bridge. No implicit host or application selector.
let installedHost: Host | undefined;
let stopInstalledHost: (() => Promise<HostReport>) | undefined;
export function installRuntimeRootHost(host: Host): void {
    if (stopInstalledHost) throw new Error('Runtime root host already installed');
    installedHost = host;
    stopInstalledHost = () => host.stop();
}
export function stopRuntimeRootHost(): Promise<HostReport> {
    if (!stopInstalledHost) throw new Error('Explicit runtime bootstrap must precede server entry');
    return stopInstalledHost();
}

export function recordRuntimeStartupFailure(original: unknown): void {
    if (!installedHost) {
        process.exitCode = 1;
        console.error('[BOOT] No explicit host for original startup failure:', original);
        return;
    }
    try { installedHost.failure('server:original-startup-phase', original); }
    catch (bookkeepingError) {
        // Do not replace the original startup exception with a secondary
        // bookkeeping exception or leave a success exit code behind.
        process.exitCode = 1;
        console.error('[BOOT] Original startup failure evidence could not be fully retained:', original, bookkeepingError);
    }
}

// A restart event requests the same original root shutdown, not a timed exit.
// Control-plane callers must not join this from a daemon task the root drains.
let requestInstalledShutdown: ((reason: string) => Promise<void>) | undefined;
export function installRuntimeRootShutdown(original: (reason: string) => Promise<void>): void {
    if (requestInstalledShutdown) throw new Error('Runtime root shutdown already installed');
    requestInstalledShutdown=original;
}
export function requestRuntimeRootShutdown(reason: string): Promise<void> {
    if (!requestInstalledShutdown) throw new Error('Explicit runtime root shutdown unavailable');
    return requestInstalledShutdown(reason);
}

/** Numeric fixed-shape diagnostic only. No service import or new stop request. */
export function runtimeRootStopProgress(): HostStopProgress | null {
    return installedHost?.stopProgress()??null;
}
