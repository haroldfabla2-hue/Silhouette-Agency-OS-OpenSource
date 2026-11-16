import type { ResourceScope } from '../../server/runtime/resourceScope';
import type { ProtocolEvent, SystemProtocol } from '../../types';
import type { systemBus } from '../systemBus';
/** Backend participant callback lifetime. A returned void only covers the handler
 * itself; detached inner work must still return its actual receipt or use scope.run. */
export function subscribeScoped(scope: ResourceScope, bus: typeof systemBus, protocol: SystemProtocol, handler: (event: ProtocolEvent) => unknown): () => void {
    scope.assertAccepting();
    const unsubscribe = bus.subscribe(protocol, event => {
        if (!scope.accepting) return;
        return scope.run(`bus:${protocol}`, () => handler(event));
    });
    scope.own({ name: `bus-subscription:${protocol}`, stopIntake: unsubscribe, close: unsubscribe });
    return unsubscribe;
}
