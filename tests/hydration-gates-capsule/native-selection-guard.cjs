'use strict';
// Core modules only. Never import a package loader or native addon here.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function inspect() {
    const forbidden = Object.keys(process.env).filter(k =>
        ['NODE_OPTIONS','NODE_PATH','LIBC','npm_config_arch','npm_config_platform',
         'PREBUILDS_ONLY','ARM_VERSION','ELECTRON_RUN_AS_NODE'].includes(k) || k.endsWith('_PREBUILD'));
    assert.equal(forbidden.length, 0, 'NATIVE_ENV_OVERRIDE');
    assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
    assert.equal(process.versions.node.split('.')[0], '22');
    for (const k of ['electron','nw','deno','bun']) assert.ok(!process.versions[k], 'NON_PLAIN_NODE');
    assert.ok(!process.isBun); assert.notEqual(typeof require.addon, 'function', 'REQUIRE_ADDON_BRANCH');
    assert.ok(process.versions.modules && /^\d+$/.test(process.versions.modules), 'ABI_UNOBSERVED');
    const header = process.report.getReport().header;
    assert.ok(typeof header.glibcVersionRuntime === 'string' && header.glibcVersionRuntime, 'GLIBC_UNOBSERVED');
    // Read the executable ELF through proc, as detect-libc does. ELF64 LE x64
    // only; any other layout is unsupported, not guessed from the host OS.
    const b = fs.readFileSync('/proc/self/exe');
    assert.equal(b.subarray(0, 4).toString('hex'), '7f454c46');
    assert.equal(b[4], 2); assert.equal(b[5], 1); assert.equal(b.readUInt16LE(18), 62);
    const offset = Number(b.readBigUInt64LE(32)), size = b.readUInt16LE(54), count = b.readUInt16LE(56);
    assert.ok(size >= 56 && count < 1024 && offset + size * count <= b.length, 'ELF_PH_BOUNDS');
    const interpreters = [];
    for (let i = 0; i < count; i++) {
        const pos = offset + i * size;
        if (b.readUInt32LE(pos) !== 3) continue;
        const start = Number(b.readBigUInt64LE(pos + 8)), length = Number(b.readBigUInt64LE(pos + 32));
        assert.ok(length > 1 && length < 256 && start + length <= b.length, 'ELF_INTERP_BOUNDS');
        interpreters.push(b.subarray(start, start + length - 1).toString('utf8'));
    }
    assert.deepEqual(interpreters, ['/lib64/ld-linux-x86-64.so.2']);
    return { platform: process.platform, arch: process.arch, node: process.versions.node,
        abi: process.versions.modules, glibc: header.glibcVersionRuntime, interpreter: interpreters[0],
        nodeSha256: sha('/proc/self/exe'), requireAddon: false, plainNode: true, forbiddenEnvironmentKeys: forbidden };
}
function verify(root) {
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'native-selection.json'), 'utf8'));
    const actual = inspect();
    assert.deepEqual(actual, doc.preparationCore, 'NATIVE_CORE_IDENTITY_DRIFT');
    const review = new Set(doc.pins.reviewOnly.map(x => x.path));
    assert.equal(review.size, 3);
    for (const [rel, digest] of Object.entries(doc.pins.files)) {
        const file = path.join(root, rel);
        assert.ok(file.startsWith(root + '/'), 'NATIVE_PIN_ESCAPE');
        if (review.has(rel)) { assert.ok(!fs.existsSync(file), 'REVIEW_ONLY_WAS_MOUNTED'); continue; }
        assert.ok(!fs.lstatSync(file).isSymbolicLink(), 'NATIVE_PIN_SYMLINK');
        assert.equal(sha(file), digest, 'NATIVE_PIN_DRIFT_' + rel);
    }
    // Reviewed loaders otherwise search these alternatives before the optional
    // package. Refuse their presence rather than claiming the optional binding
    // was chosen. Package.json pins also protect main/exports/dependencies.
    // No nested copies can shadow the pinned package dependency paths.
    for (const parent of ['@lancedb/lancedb','msgpackr-extract','node-gyp-build-optional-packages','detect-libc']) {
        const start = path.join(root, 'node_modules', parent);
        for (const pkg of doc.pins.packages) {
            for (let dir = start; dir !== root; dir = path.dirname(dir)) {
                const candidate = path.join(dir, 'node_modules', pkg.name);
                if (candidate === path.join(root, 'node_modules', pkg.name)) continue;
                assert.ok(!fs.existsSync(candidate), 'NATIVE_SHADOWED_PACKAGE');
            }
        }
    }
    const absent = [
        'node_modules/msgpackr-extract/build/Release', 'node_modules/msgpackr-extract/build/Debug',
        'node_modules/msgpackr-extract/prebuilds',
        'node_modules/@lancedb/lancedb/dist/lancedb.linux-x64-gnu.node',
        'node_modules/@lancedb/lancedb/dist/lancedb.linux-x64-musl.node'
    ];
    for (const rel of absent) assert.ok(!fs.existsSync(path.join(root, rel)), 'NATIVE_ALTERNATIVE_' + rel);
    assert.ok(!fs.existsSync(path.join(path.dirname(process.execPath), 'prebuilds')), 'NATIVE_NEARBY_PREBUILDS');
    return actual;
}
module.exports = { inspect, verify };
if (require.main === module) {
    assert.equal(process.argv[2], '--inspect');
    process.stdout.write(JSON.stringify(inspect()) + '\n');
}
