import { installPreparationHost } from './services/lifecycle/bootstrapAuthority';
import { browserOwnershipCapacity } from './browser/ownershipCapacity';

/** Explicit genuine browser ownership boundary BEFORE original React imports.
 * The imported bootstrapAuthority graph is pure bookkeeping: no server entry,
 * storage, provider, Node built-in, native client, timer or network allocation.
 * No service-level fallback host, mock bus or alternate UI is installed.
 */
// Fixed source landmarks only; no DOM/config/ownership changes.
const boundary=(stage:'BOOTSTRAP_BODY_ENTERED'|'HOST_INSTALLED'|'ENTRY_IMPORT_CALLED'|'ENTRY_IMPORT_FULFILLED'|'ENTRY_IMPORT_REJECTED')=>{
    try{console.info('SILHOUETTE_BROWSER_BOUNDARY:'+stage);}catch{/* diagnostic only */}
};
boundary('BOOTSTRAP_BODY_ENTERED');
const browserHost = installPreparationHost(browserOwnershipCapacity);
boundary('HOST_INSTALLED');
const entryOwner = browserHost.scope('frontend-entry');
const originalEntry = entryOwner.invoke('original-react-entry-import', () => {boundary('ENTRY_IMPORT_CALLED');return import('./index');});
// Retain the actual rejected original import and leave a real unhandled
// rejection visible to the browser. Do not render a fabricated fallback view.
void originalEntry.then(()=>boundary('ENTRY_IMPORT_FULFILLED'),()=>undefined);
void originalEntry.catch(original => {
    boundary('ENTRY_IMPORT_REJECTED');
    console.error('[FRONTEND] Original React entry import failed:', original);
    try { browserHost.failure('frontend:original-entry-import', original); }
    finally { throw original; }
});
// This page-session installation is not a browser teardown/quiescence claim.
// In particular, do not seal on pagehide: a bfcache-restored page may resume.
