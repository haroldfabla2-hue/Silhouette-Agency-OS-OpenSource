/** Additional harness input, NOT a frozen-product replacement. Fixed WAL entry. */
import { installPreparationHost } from '/tmp/work/services/lifecycle/bootstrapAuthority.ts';
function required(name: string): number {
    const value=Number(process.env[name]);
    if(!Number.isSafeInteger(value)||value<1) throw new Error('Missing reviewed WAL preparation capacity: '+name);
    return value;
}
const host=installPreparationHost({scopes:required('SILHOUETTE_OWNER_SCOPES'),active:required('SILHOUETTE_OWNER_ACTIVE'),failures:required('SILHOUETTE_OWNER_FAILURES'),resources:required('SILHOUETTE_OWNER_RESOURCES')});
let entryFailed=false;let entryError: unknown;
try {
    await import('/tmp/work/tests/real-process/wal-owner-control-child.ts');
} catch(original) {
    entryFailed=true;entryError=original;process.exitCode=1;
    console.error('ORIGINAL_WAL_ENTRY_FAILED',original);
}
let stopFailed=false;let stopError: unknown;
try {
    const report=await host.stop();
    // Expected original failure probes remain the original oracle's decision.
    // No acknowledgement, failure erasure or conversion of INCOMPLETE to PASS.
    console.log('WAL_PREPARATION_REPORT',JSON.stringify({state:report.state,pending:report.pending,lifetimeFailures:report.lifetimeFailures,residuals:report.residuals,coverage:report.coverage,ownerFailures:report.ownerFailures,taskOutcomeFailures:report.taskOutcomeFailures,capacity:report.capacity,highWater:report.highWater}));
} catch(original) {
    stopFailed=true;stopError=original;process.exitCode=1;
    console.error('WAL_PREPARATION_STOP_FAILED',original);
}
// Secondary bookkeeping/stop errors cannot replace the original fixture error.
if(entryFailed) throw entryError;
if(stopFailed) throw stopError;
