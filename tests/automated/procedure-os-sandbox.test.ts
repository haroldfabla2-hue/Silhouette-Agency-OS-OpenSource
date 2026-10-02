import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testOsFileProcedure } from '../../services/procedureOsSandbox';
import type { Procedure } from '../../services/memoryEvidence';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const procedure = (steps: unknown[]): Procedure => ({ id: 'test', ownerId: 'test-owner', version: 1,
    sourceIds: ['real-test'], preconditions: ['test only'], postconditions: ['hash matches'], context: 'offline',
    steps: [JSON.stringify({ schema: 1, steps })], state: 'PROPOSED', successfulRuns: 0, failedRuns: 0 });
describe('real Linux isolated declarative worker', () => {
    it('writes and verifies actual bytes, with no host output', async () => {
        const text = 'literal data, not shell: $(touch /tmp/unsafe)';
        const result = await testOsFileProcedure(procedure([{ op: 'write', path: 'sub/out.txt', text },
            { op: 'assert', path: 'sub/out.txt', sha256: hash(text) }]));
        expect(result.succeeded).toBe(true); expect(result.operations).toBe(2);
    });
    it('fails real wrong-hash and duplicate-write postconditions', async () => {
        expect((await testOsFileProcedure(procedure([{ op: 'write', path: 'out.txt', text: 'actual' },
            { op: 'assert', path: 'out.txt', sha256: hash('other') }]))).succeeded).toBe(false);
        expect((await testOsFileProcedure(procedure([{ op: 'write', path: 'out.txt', text: 'x' },
            { op: 'write', path: 'out.txt', text: 'y' }, { op: 'assert', path: 'out.txt', sha256: hash('y') }]))).succeeded).toBe(false);
    });
    it('rejects escape paths and extra executable fields', async () => {
        await expect(testOsFileProcedure(procedure([{ op: 'write', path: '../out.txt', text: 'x' },
            { op: 'assert', path: 'out.txt', sha256: hash('x') }]))).rejects.toThrow();
        expect((await testOsFileProcedure(procedure([{ op: 'write', path: 'out.txt', text: 'x', command: 'bad' },
            { op: 'assert', path: 'out.txt', sha256: hash('x') }]))).succeeded).toBe(false);
    });
    it('actual namespace denies host sentinel, ambient secret and external network', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'isolation-sentinel-'));
        const path = join(dir, 'secret.txt'); await writeFile(path, 'private test sentinel');
        try {
            const script = `const fs=require('node:fs');let denied=false;try{fs.readFileSync(${JSON.stringify(path)})}catch{denied=true};if(!denied||process.env.PRIVATE_TEST)process.exit(2);const net=require('node:net');const s=net.connect({host:'1.1.1.1',port:443});s.on('connect',()=>process.exit(3));s.on('error',()=>{console.log('isolated');process.exit(0)});setTimeout(()=>process.exit(4),1000);`;
            const result = execFileSync('/usr/bin/bwrap', ['--unshare-all', '--die-with-parent', '--clearenv',
                '--dir', '/runtime', '--ro-bind', process.execPath, '/runtime/node', '--ro-bind', '/lib', '/lib',
                '--ro-bind', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/work',
                '--chdir', '/work', '/runtime/node', '-e', script], { env: { PRIVATE_TEST: 'sentinel' }, timeout: 3000 });
            expect(result.toString().trim()).toBe('isolated');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});
