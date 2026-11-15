import { describe, expect, it } from 'vitest';
import { openSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { testOsFileProcedure } from '../../services/procedureOsSandbox';
import type { Procedure } from '../../services/memoryEvidence';
describe('real seccomp artifact and isolated worker', () => {
    it('denies actual socket creation while declarative disk/hash work succeeds', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'seccomp-test-')); const path = join(dir, 'filter.bpf');
        try {
            execFileSync('python3', ['scripts/generate_procedure_seccomp.py', '--output', path]);
            const bytes = await readFile(path); const sha256 = createHash('sha256').update(bytes).digest('hex');
            const hash = createHash('sha256').update('actual').digest('hex');
            const procedure: Procedure = { id: 'test', version: 1, ownerId: 'test-owner', steps: [JSON.stringify({ schema: 1, steps: [{ op: 'write', path: 'out.txt', text: 'actual' }, { op: 'assert', path: 'out.txt', sha256: hash }] })], sourceIds: ['test'], preconditions: ['test'], postconditions: ['hash'], context: 'test-only', state: 'PROPOSED', successfulRuns: 0, failedRuns: 0 };
            expect((await testOsFileProcedure(procedure, { path, sha256 })).succeeded).toBe(true);
            await expect(testOsFileProcedure(procedure, { path, sha256: '0'.repeat(64) })).rejects.toThrow('artifact');
            const fd = openSync(path, 'r');
            let result: Buffer;
            try { result = execFileSync('/usr/bin/bwrap', ['--unshare-all', '--die-with-parent', '--clearenv', '--ro-bind', process.execPath, '/node', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/work', '--chdir', '/work', '--seccomp', '3', '/node', '-e', "const s=require('node:net').createServer();s.on('error',e=>{if(e.code==='EPERM'){console.log('denied');process.exit(0)}process.exit(2)});s.on('listening',()=>process.exit(3));s.listen(0);"], { input: '', stdio: ['pipe', 'pipe', 'pipe', fd], timeout: 5000 }); } finally { closeSync(fd); }
            expect(result.toString().trim()).toBe('denied');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});
