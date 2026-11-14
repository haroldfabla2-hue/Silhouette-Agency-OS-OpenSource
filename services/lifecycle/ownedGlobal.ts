import { preserveOriginal } from './preserveOriginal';
import type { Scope, ResourceEvidence } from './host';

/** Own exactly one global installation. Never overwrite a subsequent actor. */
export function installOwnedFunction<T extends object, K extends keyof T>(
    scope: Scope, target: T, key: K,
    build: (predecessor: T[K], active: () => boolean) => T[K],
): { retire: () => ResourceEvidence } {
    return scope.invoke('install:' + String(key), operation => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const predecessor = target[key];
    let active = true;
    const permit = scope.reserveResource(operation, String(key));
    let installed: T[K];
    try {
        installed = build(predecessor, () => active);
        // Preserve guarded assignment; never bypass a read-only global.
        target[key] = installed;
    } catch (error) {
        preserveOriginal(scope, 'global-install-failed', () => scope.releaseUnused(permit)); throw error;
    }
    const installedDescriptor = Object.getOwnPropertyDescriptor(target, key);
    if (target[key] !== installed) { scope.releaseUnused(permit); throw new Error('Global installation was not accepted'); }
    let outcome: ResourceEvidence | undefined;
    const retire = (): ResourceEvidence => {
        if (outcome) return outcome;
        active = false;
        const current = Object.getOwnPropertyDescriptor(target, key);
        const sameDescriptor = current?.configurable === installedDescriptor?.configurable
            && current?.enumerable === installedDescriptor?.enumerable
            && current?.writable === installedDescriptor?.writable
            && current?.get === installedDescriptor?.get && current?.set === installedDescriptor?.set;
        if (target[key] !== installed || !sameDescriptor) {
            outcome = { source: scope.label + ':' + String(key), disposition: 'INCOMPLETE', reason: 'FOREIGN_GLOBAL_REPLACEMENT_OR_WRAPPER' };
            scope.unknown(outcome.source + ':' + outcome.reason); return outcome;
        }
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else delete target[key];
        outcome = { source: scope.label + ':' + String(key), disposition: 'CLOSED' }; return outcome;
    };
    const installation = {};
    scope.acquire(permit, installation, retire, () => outcome ?? { source: scope.label + ':' + String(key), disposition: 'INCOMPLETE', reason: 'RETIREMENT_UNVERIFIED' });
    scope.onSeal(() => { active = false; });
    return { retire };
    });
}
