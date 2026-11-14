/** Explicit, real-host generation ownership. No hook registration here. */
import { expect } from 'vitest';
import type { Host, HostReport } from '../../services/lifecycle/host';
type Generation = { host: Host; joined?: Promise<HostReport> };
type FileOwner = { byAuthority: WeakMap<object,Generation>; generations: Set<Generation>; sealed: boolean; joined?: Promise<void> };
type Registry = { files: Map<string,FileOwner> };
const registryKey=Symbol.for('silhouette.authored-tests.explicit-preparation-generations.v2');
const roots=globalThis as typeof globalThis & { [registryKey]?: Registry };
const registry=roots[registryKey]??={files:new Map<string,FileOwner>()};
function fileOwner(): FileOwner {
    const path=expect.getState().testPath;
    if (!path) throw new Error('Explicit test file identity unavailable before preparation');
    let owner=registry.files.get(path);
    if (!owner) {owner={byAuthority:new WeakMap<object,Generation>(),generations:new Set<Generation>(),sealed:false};registry.files.set(path,owner);}
    return owner;
}
function required(name: string): number {
    const value=Number(process.env[name]);
    if (!Number.isSafeInteger(value)||value<1) throw new Error('Missing explicit test preparation capacity: '+name);
    return value;
}
export async function installTestHostGeneration(): Promise<void> {
    const owner=fileOwner();
    if(owner.sealed) throw new Error('Test file generation admission is sealed');
    // Dynamic lookup deliberately follows actual vi.resetModules bindings.
    const { installPreparationHost }=await import('../../services/lifecycle/bootstrapAuthority');
    if(owner.sealed) throw new Error('Test file generation admission closed during import');
    if(owner.byAuthority.has(installPreparationHost)) return;
    // No await between identity check, real install and retention. Concurrent
    // callers cannot both install the same evaluated module generation.
    const host=installPreparationHost({scopes:required('SILHOUETTE_OWNER_SCOPES'),active:required('SILHOUETTE_OWNER_ACTIVE'),failures:required('SILHOUETTE_OWNER_FAILURES'),resources:required('SILHOUETTE_OWNER_RESOURCES')});
    const record={host};owner.byAuthority.set(installPreparationHost,record);owner.generations.add(record);
}
export function sealAndDrainTestFileGenerations(): Promise<void> {
    const owner=fileOwner();owner.sealed=true;
    if(owner.joined) return owner.joined;
    owner.joined=(async () => {
        // All original generations for THIS file, including old reset graphs.
        // Other files' stopped hosts/failures must not be re-reported as ours.
        const results=await Promise.allSettled([...owner.generations].map(record => record.joined??=Promise.resolve().then(() => record.host.stop())));
        const actualFailures: unknown[]=[];
        for (const result of results) {
            if (result.status==='rejected') {actualFailures.push(result.reason);continue;}
            console.log('PREPARATION_GENERATION_REPORT',JSON.stringify({state:result.value.state,pending:result.value.pending,lifetimeFailures:result.value.lifetimeFailures,residuals:result.value.residuals,coverage:result.value.coverage}));
            if(result.value.lifetimeFailures) actualFailures.push(new Error('Original generation failures: '+result.value.lifetimeFailures));
        }
        if(actualFailures.length) throw new AggregateError(actualFailures,'Original test generation teardown failed');
    })();
    return owner.joined;
}
