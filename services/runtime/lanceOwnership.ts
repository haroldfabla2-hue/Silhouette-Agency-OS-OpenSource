import type { ResourceScope } from '../../server/runtime/resourceScope';

interface LanceHandle { close(): void }
/** Every connection/table is independent in pinned0.22.3. Register actual tables,
 * including temporary and replaced handles. Parent scope drains all users first. */
export function ownLanceConnection<T extends LanceHandle>(scope: ResourceScope, name: string, handle: T): T {
    scope.own({ name: `lance-connection:${name}`, closeRank: -100, close: () => handle.close() });
    return handle;
}
export function ownLanceTable<T extends LanceHandle>(scope: ResourceScope, name: string, handle: T): T {
    scope.own({ name: `lance-table:${name}`, closeRank: 0, close: () => handle.close() });
    return handle;
}
/** Native memory release is NOT implied by flush or dropping JS references.
 * Binding2.26.4 has no dispose. Runtime is single-use and owns it until natural exit. */
export function ownProcessAnn(scope: ResourceScope, name: string, ann: {
    stopIntake(): void;
    flushPending(): Promise<void>;
    releaseReferences(): void;
}): void {
    scope.own({ name: `ann:${name}`, stopIntake: () => ann.stopIntake(), flush: () => ann.flushPending(),
        close: () => {
            ann.releaseReferences();
            return { state: 'PROCESS_OWNED_UNVERIFIED_UNTIL_NATURAL_EXIT', detail: 'USearch2.26.4 has no deterministic JS disposal API' };
        },
    });
}
