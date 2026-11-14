import { installPreparationHost } from '../services/lifecycle/bootstrapAuthority';
import { serverOwner } from '../services/lifecycle/preparationBindings';
import type { Capacity } from '../services/lifecycle/host';

/** PROPOSED entry only. package/build/Electron still target the old entry.
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
// Source preparation deliberately leaves PRODUCT_FRONTIER_INTEGRATION_INCOMPLETE
// permanent. This entry is not eligible for execution or a COMPLETE claim.
const applicationImport = serverOwner().invoke('original-entry-import', () => import('./index'));
void applicationImport.catch(error => {
    preparedHost.failure('server:original-entry-import', error);
    preparedHost.unknown('server:ENTRY_EVALUATION_UNVERIFIED', true);
});
