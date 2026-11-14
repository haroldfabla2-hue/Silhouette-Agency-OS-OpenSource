import { createHost, type Host, type Capacity, type Scope } from './host';
import { fixedNames, installFixedBindings } from './preparationBindings';

/** Only reviewed bootstrap entries import this module. No application service. */
export function installPreparationHost(capacity: Capacity): Host {
    const host = createHost(capacity);
    const scopes = {} as Record<typeof fixedNames[number], Scope>;
    for (const name of fixedNames) scopes[name] = host.scope(name);
    installFixedBindings(Object.freeze(scopes), Object.freeze({
        lance: () => host.scope('lance:independent'),
        introspection: () => host.scope('introspection:independent'),
        brainBridge: () => host.scope('brainBridge:independent'),
        codebase: () => host.scope('codebase:independent'),
        daemon: () => host.scope('daemon:independent'),
    }));
    // Guard stays global: unknown first-party work could share any resource.
    host.unknown('PRODUCT_FRONTIER_INTEGRATION_INCOMPLETE', true);
    return host;
}
