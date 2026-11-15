import type { ExecutionLease, ProcedureApprovalLedger } from './procedureApprovalLedger';
import { testOsFileProcedure, type SeccompArtifact } from './procedureOsSandbox';
import type { SandboxReceipt } from './procedureFileSandbox';

/** Explicit lease only; registry approval alone never starts execution. No endpoint/daemon. */
export async function runLeasedFileProcedure(ledger: ProcedureApprovalLedger, lease: ExecutionLease,
    options: { seccomp?: SeccompArtifact; signal?: AbortSignal; onSpawn?: (pid: number) => void } = {}):
    Promise<{ state: 'SUCCEEDED' | 'FAILED' | 'REVOKED'; receipt: SandboxReceipt }> {
    const procedure = ledger.contractFor(lease); // Canonical immutable contract, not caller-supplied steps.
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const check = () => { try { if (!ledger.isCurrent(lease)) cancel(); } catch { cancel(); } };
    const monitor = setInterval(check, 25); // Local SQLite only, not website/account polling.
    let receipt: SandboxReceipt;
    try {
        receipt = await testOsFileProcedure(procedure, options.seccomp,
            { signal: controller.signal, beforeStart: () => ledger.isCurrent(lease), onSpawn: options.onSpawn });
    } catch {
        receipt = { procedureId: lease.procedureId, version: lease.version, ownerId: lease.ownerId,
            contractHash: lease.contractHash, succeeded: false, operations: 0 };
    } finally {
        clearInterval(monitor); options.signal?.removeEventListener('abort', cancel);
    }
    // Transactional after-check prevents success across a concurrent revocation.
    const state = ledger.finish(lease, receipt);
    return { state, receipt };
}
