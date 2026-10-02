import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { MemoryEvidence, type Procedure } from './memoryEvidence';
export type FileStep = { op: 'write'; path: string; text: string } | { op: 'assert'; path: string; sha256: string };
export interface FileContract { schema: 1; steps: FileStep[] }
export interface SandboxReceipt { procedureId: string; version: number; ownerId: string; contractHash: string; succeeded: boolean; operations: number }
export function encodeFileContract(contract: FileContract): string { return JSON.stringify(contract); }
export function decodeFileContract(procedure: Procedure): FileContract {
    if (procedure.steps.length !== 1 || procedure.steps[0].length > 2 * 1024 * 1024) throw new Error('Only one declarative file contract is supported');
    const contract = JSON.parse(procedure.steps[0]) as FileContract;
    if (contract.schema !== 1 || !Array.isArray(contract.steps) || !contract.steps.length || contract.steps.length > 32) throw new Error('Invalid contract');
    let bytes = 0;
    for (const step of contract.steps) {
        // No shell, code, network, absolute paths, separators, dot segments or symlinks supplied by users.
        if (!step || typeof step.path !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/.test(step.path)) throw new Error('Unsafe file path');
        if (step.op === 'write' && typeof step.text === 'string') bytes += Buffer.byteLength(step.text);
        else if (step.op !== 'assert' || typeof step.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(step.sha256)) throw new Error('Unsupported operation');
    }
    if (!contract.steps.some(step => step.op === 'assert')) throw new Error('At least one hash postcondition is required');
    if (bytes > 1024 * 1024) throw new Error('Sandbox byte budget exceeded');
    return contract;
}
/** A closed declarative capability sandbox, NOT isolation for arbitrary executable code. */
export async function testFileProcedure(procedure: Procedure): Promise<SandboxReceipt> {
    const contract = decodeFileContract(procedure);
    const directory = await mkdtemp(join(tmpdir(), 'procedure-sandbox-'));
    let operations = 0, succeeded = false;
    try {
        for (const step of contract.steps) {
            const path = join(directory, step.path);
            if (step.op === 'write') { await mkdir(dirname(path), { recursive: true }); await writeFile(path, step.text, { flag: 'wx' }); }
            else if (createHash('sha256').update(await readFile(path)).digest('hex') !== step.sha256) throw new Error('Postcondition mismatch');
            operations++;
        }
        succeeded = true;
    } catch { succeeded = false; }
    finally { await rm(directory, { recursive: true, force: true }); }
    return { procedureId: procedure.id, version: procedure.version, ownerId: procedure.ownerId,
        contractHash: createHash('sha256').update(procedure.steps[0]).digest('hex'), succeeded, operations };
}
/** Caller must authenticate human approval before MemoryEvidence.approveProcedure. */
export async function runApprovedFileProcedure(registry: MemoryEvidence, id: string, version: number, ownerId: string): Promise<SandboxReceipt> {
    const procedure = (await registry.actionableProcedures(ownerId)).find(p => p.id === id && p.version === version);
    if (!procedure) throw new Error('Procedure is not approved for this owner/version');
    let receipt: SandboxReceipt;
    try { receipt = await testFileProcedure(procedure); }
    catch (error) { await registry.recordProcedureOutcome(id, version, ownerId, false); throw error; }
    await registry.recordProcedureOutcome(id, version, ownerId, receipt.succeeded);
    return receipt;
}
