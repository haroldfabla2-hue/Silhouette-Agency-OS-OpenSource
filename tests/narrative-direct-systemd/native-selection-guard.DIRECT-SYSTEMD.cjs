'use strict';
// Core modules only. Never import a package loader or native addon here.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function inspect() {
    const forbidden = Object.keys(process.env).filter(k =>
        ['NODE_OPTIONS','NODE_PATH','LIBC','npm_config_arch','npm_config_platform',
         'PREBUILDS_ONLY','ARM_VERSION','ELECTRON_RUN_AS_NODE','npm_config_libc',
         'npm_config_arm_version','LD_LIBRARY_PATH','LD_PRELOAD','LD_AUDIT',
         'NODE_BINDINGS_ARROW','NODE_BINDINGS_COMPILED_DIR'].includes(k) || k.endsWith('_PREBUILD'));
    assert.equal(forbidden.length, 0, 'NATIVE_ENV_OVERRIDE');
    assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
    assert.equal(process.versions.node.split('.')[0], '22');
    for (const k of ['electron','nw','deno','bun']) assert.ok(!process.versions[k], 'NON_PLAIN_NODE');
    assert.ok(!process.isBun); assert.notEqual(typeof require.addon, 'function', 'REQUIRE_ADDON_BRANCH');
    assert.ok(process.versions.modules && /^\d+$/.test(process.versions.modules), 'ABI_UNOBSERVED');
    const header = process.report.getReport().header;
    assert.ok(typeof header.glibcVersionRuntime === 'string' && header.glibcVersionRuntime, 'GLIBC_UNOBSERVED');
    // DIRECT_SYSTEMD instrumentation: proc is hidden to protect host processes.
    // The trusted manager execs this absolute pinned binary in a readonly root.
    // This is file identity, NOT an observed /proc/self/exe binding.
    assert.equal(process.execPath, '/usr/bin/node', 'PINNED_EXECUTABLE_PATH');
    assert.ok(!fs.lstatSync('/usr/bin/node').isSymbolicLink(), 'PINNED_EXECUTABLE_SYMLINK');
    const b = fs.readFileSync('/usr/bin/node');
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
        nodeSha256: sha('/usr/bin/node'), requireAddon: false, plainNode: true, forbiddenEnvironmentKeys: forbidden };
}
function verifyTree(root, pins, installed) {
    root = path.resolve(root);
    const review = new Set(pins.reviewOnly.map(x => x.path));
    assert.equal(review.size, 5);
    for (const [rel, digest] of Object.entries(pins.files)) {
        const file = path.resolve(root, rel);
        assert.ok(file.startsWith(root + '/'), 'NATIVE_PIN_ESCAPE');
        if (review.has(rel) && !installed) { assert.ok(!fs.existsSync(file), 'REVIEW_ONLY_WAS_MOUNTED'); continue; }
        for (let dir = file; dir !== root; dir = path.dirname(dir))
            assert.ok(!fs.lstatSync(dir).isSymbolicLink(), 'NATIVE_PIN_SYMLINK');
        assert.equal(sha(file), digest, 'NATIVE_PIN_DRIFT_' + rel);
    }
    // Resolve each reviewed dependency using Node's ancestor search, without
    // importing it. This covers Sharp's effectively resolved detect-libc too.
    const roots = new Map(pins.packages.map(p => [p.name, p.path || 'node_modules/' + p.name]));
    for (const pkg of pins.packages) {
        const parent = path.join(root, pkg.path || 'node_modules/' + pkg.name);
        const meta = JSON.parse(fs.readFileSync(path.join(parent, 'package.json')));
        for (const dep of Object.keys({...meta.dependencies, ...meta.optionalDependencies})) {
            if (!roots.has(dep)) continue;
            let found;
            for (let dir = parent; dir.startsWith(root); dir = path.dirname(dir)) {
                const candidate = path.join(dir, 'node_modules', dep, 'package.json');
                if (fs.existsSync(candidate)) { found = path.dirname(candidate); break; }
                if (dir === root) break;
            }
            assert.equal(found, path.join(root, roots.get(dep)), 'NATIVE_SHADOWED_DEPENDENCY_' + dep);
        }
    }
    const absent = [
        'node_modules/msgpackr-extract/build/Release', 'node_modules/msgpackr-extract/build/Debug',
        'node_modules/msgpackr-extract/prebuilds',
        'node_modules/@lancedb/lancedb/dist/lancedb.linux-x64-gnu.node',
        'node_modules/@lancedb/lancedb/dist/lancedb.linux-x64-musl.node',
        'node_modules/usearch/build'
    ];
    // getBuildDir walks from CJS/ESM toward package root. Neither an earlier
    // build/prebuild nor a .next detour may short-circuit that pinned root.
    for (const rel of ['javascript/dist/cjs','javascript/dist/esm','javascript/dist','javascript'])
        for (const kind of ['build','prebuilds']) absent.push('node_modules/usearch/' + rel + '/' + kind);
    for (const rel of absent) assert.ok(!fs.existsSync(path.join(root, rel)), 'NATIVE_ALTERNATIVE_' + rel);
    const prebuilds = path.join(root, 'node_modules/usearch/prebuilds');
    // Closed tree, not a generic architecture exclusion. The unused arm64
    // binding remains only in the review artifact, not the mounted tree.
    assert.deepEqual(fs.readdirSync(prebuilds).sort(), installed ?
        ['darwin-arm64+x64','linux-arm64','linux-x64','win32-x64'] :
        ['darwin-arm64+x64','linux-x64','win32-x64']);
    assert.deepEqual(fs.readdirSync(path.join(prebuilds, 'linux-x64')), ['usearch.node']);
    assert.ok(!fs.existsSync(path.join(path.dirname(process.execPath), 'prebuilds')), 'NATIVE_NEARBY_PREBUILDS');
}
function verify(root) {
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'native-selection.json'), 'utf8'));
    const actual = inspect();
    assert.deepEqual(actual, doc.preparationCore, 'NATIVE_CORE_IDENTITY_DRIFT');
    verifyTree(root, doc.pins, false);
    return actual;
}
module.exports = { inspect, verify, verifyTree };
if (require.main === module) {
    const actual = inspect();
    if (process.argv[2] === '--verify-installed') {
        const pins = JSON.parse(fs.readFileSync(process.argv[4]));
        verifyTree(process.argv[3], pins, true);
    } else assert.equal(process.argv[2], '--inspect');
    process.stdout.write(JSON.stringify(actual) + '\n');
}
