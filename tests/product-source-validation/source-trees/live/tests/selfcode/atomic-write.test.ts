import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, spawnSync, execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
const tsxLoader = pathToFileURL(path.join(path.dirname(fs.realpathSync(execFileSync('which', ['tsx'], { encoding: 'utf8' }).trim())), 'loader.mjs')).href;
const workerArgs = (target: string, size: number) => ['--import', tsxLoader, path.join(import.meta.dirname, 'atomic-worker.ts'), target, String(size)];
import { atomicWriteFile } from '../../services/selfdev/atomicWrite';

const digest = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'selfcode-atomic-'));

test('real filesystem: UTF8, permissions, new-file mode, exact bytes and no temporary leftovers', () => {
    const dir = scratch();
    try {
        const target = path.join(dir, 'code.ts');
        fs.writeFileSync(target, 'old'); fs.chmodSync(target, 0o640);
        atomicWriteFile(target, 'const saludo = "mañana 🦋";\n');
        assert.equal(fs.readFileSync(target, 'utf8'), 'const saludo = "mañana 🦋";\n');
        assert.equal(fs.statSync(target).mode & 0o777, 0o640);
        const fresh = path.join(dir, 'new.ts'); atomicWriteFile(fresh, 'new');
        assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['code.ts', 'new.ts']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real symlink target rejected without modifying referent', () => {
    const dir = scratch();
    try {
        const referent = path.join(dir, 'outside'); fs.writeFileSync(referent, 'old');
        const target = path.join(dir, 'link'); fs.symlinkSync(referent, target);
        assert.throws(() => atomicWriteFile(target, 'new'), /regular file/);
        assert.equal(fs.readFileSync(referent, 'utf8'), 'old');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real directory target rejected without mutation', () => {
    const dir = scratch();
    try {
        const target = path.join(dir, 'directory'); fs.mkdirSync(target);
        assert.throws(() => atomicWriteFile(target, 'new'), /regular file/);
        assert.deepEqual(fs.readdirSync(dir), ['directory']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real SIGKILL after sibling temporary appears: original remains complete', { timeout: 30000 }, async () => {
    const dir = scratch();
    const target = path.join(dir, 'code.ts');
    const old = Buffer.alloc(256 * 1024, 0x4f); fs.writeFileSync(target, old);
    // Large helper input widens the observable write window. Service limits
    // remain 256KiB; this is interruption testing of the shared I/O primitive.
    const child = spawn(process.execPath, workerArgs(target, 64 * 1024 * 1024), { stdio: ['ignore', 'pipe', 'pipe'] });
    let killed = false;
    let errors = '';
    child.stderr.on('data', b => errors += b);
    const watcher = fs.watch(dir, (_event, filename) => {
        if (filename?.toString().startsWith('.selfcode-') && !killed) {
            killed = child.kill('SIGKILL');
        }
    });
    try {
        const result = await new Promise<{code: number | null; signal: string | null}>((resolve, reject) => {
            child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
        });
        assert.equal(killed, true, errors);
        assert.equal(result.signal, 'SIGKILL');
        assert.throws(() => process.kill(child.pid!, 0), /ESRCH/);
        assert.equal(digest(fs.readFileSync(target)), digest(old));
        // SIGKILL cannot run finally. Orphan temporary files are expected and
        // are not promoted/recovered automatically.
        console.log(JSON.stringify({ interruption: 'SIGKILL', target: 'old-exact', temporaryFiles: fs.readdirSync(dir).filter(n => n.startsWith('.selfcode-')).length }));
    } finally { watcher.close(); child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real child completes replacement: target is complete new bytes', () => {
    const dir = scratch();
    try {
        const target = path.join(dir, 'code.ts'); fs.writeFileSync(target, 'old');
        const size = 256 * 1024;
        const result = spawnSync(process.execPath, workerArgs(target, size), { encoding: 'utf8', timeout: 15000 });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(digest(fs.readFileSync(target)), digest(Buffer.alloc(size, 0x4e)));
        assert.deepEqual(fs.readdirSync(dir), ['code.ts']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('real rename error after staging: directory collision leaves no temporary file', { timeout: 30000 }, async () => {
    const dir = scratch(); const target = path.join(dir, 'code.ts');
    let collision = false;
    const watcher = fs.watch(dir, (_event, name) => {
        if (name?.toString().startsWith('.selfcode-') && !collision) {
            fs.mkdirSync(target); collision = true;
        }
    });
    const child = spawn(process.execPath, workerArgs(target, 64 * 1024 * 1024), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', b => stderr += b);
    try {
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        assert.equal(collision, true);
        assert.notEqual(code, 0);
        assert.match(stderr, /EISDIR|ENOTDIR/);
        assert.equal(fs.statSync(target).isDirectory(), true);
        assert.deepEqual(fs.readdirSync(dir), ['code.ts']);
    } finally { watcher.close(); child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});


test('hard-link target refused before any write, both names unchanged', () => {
    const dir = scratch();
    try {
        const target = path.join(dir, 'code.ts'), alias = path.join(dir, 'alias.ts');
        fs.writeFileSync(target, 'old'); fs.linkSync(target, alias);
        assert.throws(() => atomicWriteFile(target, 'new'), /hard-linked.*unchanged/);
        assert.equal(fs.readFileSync(target, 'utf8'), 'old');
        assert.equal(fs.readFileSync(alias, 'utf8'), 'old');
        assert.equal(fs.statSync(target).ino, fs.statSync(alias).ino);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['alias.ts', 'code.ts']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('existing special permission bits preserved on replacement', () => {
    const dir = scratch();
    try {
        const target = path.join(dir, 'code.ts'); fs.writeFileSync(target, 'old'); fs.chmodSync(target, 0o4750);
        const before = fs.statSync(target).mode & 0o7777;
        assert.equal(before, 0o4750);
        atomicWriteFile(target, 'new');
        assert.equal(fs.statSync(target).mode & 0o7777, before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
