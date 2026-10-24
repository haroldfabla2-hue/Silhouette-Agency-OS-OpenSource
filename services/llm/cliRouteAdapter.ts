/**
 * [auth-connections] Gateway adapter for official-CLI routes: the router's
 * real entry (createAgentInferenceRouter -> streamPrepared) traverses this
 * adapter like any other provider. The ACTIVE CLI account (method 'command')
 * is resolved here; the vendor binary answers through runOfficialCli; the
 * vendor CLI owns its OAuth. Non-streaming by nature: one yield with the
 * CLI's full stdout (same honest shape as the ZHIPUAI adapter).
 */
import { InferenceError, type PreparedAgentRequest } from './inference';
import type { StreamAdapter } from './streamAdapters';
import type { AccountStore } from '../auth/accountStore';
import { buildCliInvocation, resolveOfficialBin, runOfficialCli, officialCliBins } from '../auth/cliTransport';
import { officialRoutes } from '../auth/officialRoutes';

export interface CliRouteAdapterDeps {
    store: AccountStore;
    env?: NodeJS.ProcessEnv;
    allowedBinDirs?: string[];
    timeoutMs?: number;
}

export function cliRouteAdapter(routeId: string, deps: CliRouteAdapterDeps): StreamAdapter {
    const binSpec = officialCliBins[routeId];
    const route = officialRoutes.find(r => r.routeId === routeId);
    if (!binSpec || !route) throw new Error(`unknown official CLI route: ${routeId}`);
    const providerId = route.providerId;
    const env = deps.env ?? process.env;

    function activeCliAccount() {
        const account = deps.store.active(providerId);
        return account && account.method === 'command' ? account : undefined;
    }

    return {
        id: providerId,
        isAvailable: () => {
            if (!activeCliAccount()) return false;
            try { resolveOfficialBin(binSpec.bin, env, deps.allowedBinDirs); return true; } catch { return false; }
        },
        async *stream(prepared: PreparedAgentRequest) {
            const account = activeCliAccount();
            if (!account) throw new InferenceError(providerId, 'unavailable', 'no active CLI account');
            let binPath: string;
            try {
                binPath = resolveOfficialBin(binSpec.bin, env, deps.allowedBinDirs);
            } catch (err: any) {
                throw new InferenceError(providerId, 'unavailable', err?.message || 'official CLI not found', { cause: err });
            }
            const prompt = prepared.systemPrompt ? `${prepared.systemPrompt}\n\n${prepared.task}` : prepared.task;
            // binPath is trusted here because resolveOfficialBin just validated it.
            const invocation = buildCliInvocation(account, binPath, binSpec.headlessArgs(prompt), env, { allowAbsoluteBin: true, routeId });
            let result;
            try {
                result = await runOfficialCli(invocation, { ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}) });
            } catch (err: any) {
                throw new InferenceError(providerId, 'unavailable', err?.message || 'official CLI failed to start', { cause: err });
            }
            if (result.timedOut) throw new InferenceError(providerId, 'timeout', `${binSpec.bin} exceeded timeout`);
            if (result.exitCode !== 0) {
                throw new InferenceError(providerId, 'provider-error', `${binSpec.bin} exited ${result.exitCode}: ${result.stderr.slice(0, 200)}`);
            }
            const text = result.stdout.trim();
            if (text) yield text;
        },
    };
}
