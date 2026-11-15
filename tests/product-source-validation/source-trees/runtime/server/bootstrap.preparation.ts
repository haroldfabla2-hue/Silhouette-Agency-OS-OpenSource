import { installPreparationHost } from '../services/lifecycle/bootstrapAuthority';
import { serverOwner } from '../services/lifecycle/preparationBindings';
import type { Capacity } from '../services/lifecycle/host';
import { installRuntimeRootHost } from './runtimeRootHost';

/** Candidate runtime entry. package/server build target this before imports.
 * No production numbers are silently chosen. Capacity inputs must come from
 * the reviewed execution environment, not a source-code guess.
 */
function required(name: string): number {
    const value = Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Missing explicit capacity: ' + name);
    return value;
}
const capacity: Capacity = {
    scopes: required('SILHOUETTE_OWNER_SCOPES'),
    active: required('SILHOUETTE_OWNER_ACTIVE'),
    failures: required('SILHOUETTE_OWNER_FAILURES'),
    resources: required('SILHOUETTE_OWNER_RESOURCES'),
};
const preparedHost = installPreparationHost(capacity);
installRuntimeRootHost(preparedHost);
// Source preparation deliberately leaves PRODUCT_FRONTIER_INTEGRATION_INCOMPLETE
// permanent. Wiring this entry is not a COMPLETE or runtime-validation claim.
const applicationImport = serverOwner().invoke('original-entry-import', () => import('./index'));
void applicationImport.catch(error => {
    // An import failure is a real startup failure, not a live silent server.
    // Set nonzero first so even an empty event loop cannot look successful.
    process.exitCode = 1;
    console.error('[BOOT] Original application import failed:', error);
    const failedStartupDeadline = setTimeout(() => {
        console.error('[BOOT] Startup failure cleanup deadline; original error retained above');
        process.exit(1);
    }, 10000);
    failedStartupDeadline.unref();
    try { preparedHost.failure('server:original-entry-import', error); }
    finally {
        preparedHost.unknown('server:ENTRY_EVALUATION_UNVERIFIED', true);
        void preparedHost.stop().catch(stopError => console.error('[BOOT] Startup failure cleanup rejected:', stopError));
    }
});
