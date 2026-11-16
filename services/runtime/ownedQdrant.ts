import type { QdrantClient, QdrantClientParams } from '@qdrant/js-client-rest';
import { ResourceScope } from '../../server/runtime/resourceScope';

/** A lease owns one actual dispatcher; each SDK request has a receipt.
 * Caller retires failed/replaced leases instead of dropping the last reference. */
export interface OwnedQdrantLease {
    readonly client: QdrantClient;
    close(): ReturnType<ResourceScope['close']>;
}
export async function acquireOwnedQdrant(parent: ResourceScope, options: QdrantClientParams): Promise<OwnedQdrantLease> {
    return parent.run('qdrant-client-acquisition', async () => {
        if (typeof window !== 'undefined') throw new Error('Owned Qdrant transport requires Node');
        const [{ Agent }, { QdrantClient }] = await Promise.all([import('undici'), import('@qdrant/js-client-rest')]);
        parent.assertAccepting();
        if (QdrantClient.supportsExternalDispatcher !== true) throw new Error('Pinned Qdrant ownership patch missing; no client was constructed');
        const requests = new ResourceScope('qdrant-lease');
        // Retain lease BEFORE SDK construction/validation. Agent exists only inside it.
        parent.own({ name: 'qdrant-lease', close: async () => {
            const report = await requests.close();
            for (const diagnostic of report.diagnostics) parent.recordDiagnostic(`qdrant:${diagnostic.resource}`, diagnostic.error, diagnostic.disposition, diagnostic.originalCapability);
            if (report.failures.length) throw new AggregateError(report.failures.map(f => f.error), 'Qdrant lease release contains failed cleanup');
            return { state: report.fullyReleased ? 'RELEASED' : 'UNVERIFIED' };
        } });
        try {
            const dispatcher = new Agent({ bodyTimeout: 0, headersTimeout: 0, connections: options.maxConnections ?? 25, keepAliveTimeout: 10000 });
            requests.own({ name: 'qdrant-undici-agent', close: () => dispatcher.close() });
            const sdk = new QdrantClient({ ...options, transportDispatcher: dispatcher });
            const client = new Proxy(sdk, {
                get(target, property, receiver) {
                    const value = Reflect.get(target, property, receiver);
                    if (typeof value !== 'function') return value;
                    // api() would expose untracked generated request methods. Product does
                    // not use it; refuse instead of pretending those methods are owned.
                    if (property === 'api') return () => { throw new Error('Raw Qdrant API requires explicit scoped adapter'); };
                    return (...args: unknown[]) => requests.run(String(property), () => Reflect.apply(value, target, args));
                },
            });
            return { client, close: () => requests.close() };
        } catch (error) {
            await requests.close();
            throw error;
        }
    });
}
