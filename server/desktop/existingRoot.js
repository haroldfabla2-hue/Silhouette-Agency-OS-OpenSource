// Read-only descriptor validation BEFORE product imports. Descriptor+digest
// must come from a separately reviewed existing-install chooser, never IPC or
// model content. Hash equality is integrity, not user approval/authentication.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
function verify(descriptor, trustedDigest) {
    const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
    const id = value => typeof value === 'string' && /^\d+$/.test(value);
    const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (!plain(descriptor) || typeof descriptor.cwd !== 'string' || !id(descriptor.dev) || !id(descriptor.ino) || !digest(descriptor.environmentSha256)) throw new Error('DESKTOP_SELECTION_SCHEMA');
    if (!plain(descriptor.database) || typeof descriptor.database.path !== 'string' || !id(descriptor.database.dev) || !id(descriptor.database.ino)) throw new Error('DESKTOP_SELECTION_SCHEMA');
    if (typeof trustedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(trustedDigest) || hash(JSON.stringify(descriptor)) !== trustedDigest) throw new Error('DESKTOP_SELECTION_INTEGRITY');
    const canonical = value => typeof value === 'string' && path.isAbsolute(value) && fs.realpathSync(value) === path.normalize(value);
    if (!canonical(descriptor.cwd) || fs.realpathSync(process.cwd()) !== descriptor.cwd) throw new Error('DESKTOP_EXISTING_CWD_REQUIRED');
    const cwd = fs.statSync(descriptor.cwd);
    if (!cwd.isDirectory() || String(cwd.dev) !== descriptor.dev || String(cwd.ino) !== descriptor.ino) throw new Error('DESKTOP_ROOT_CHANGED');
    // Hash exact inherited environment without emitting/persisting its values.
    // Source files may later load dotenv; their bytes are covered below.
    const env = Object.keys(process.env).sort().map(key => [key, process.env[key]]);
    if (hash(JSON.stringify(env)) !== descriptor.environmentSha256) throw new Error('DESKTOP_ENV_CHANGED');
    if (!Array.isArray(descriptor.existing) || descriptor.existing.length < 2 || descriptor.existing.length > 256) throw new Error('DESKTOP_STORE_SELECTION_REQUIRED');
    const seen = new Set();
    const kinds = new Map();
    for (const item of descriptor.existing) {
        if (!plain(item) || !['file', 'directory'].includes(item.kind) || typeof item.path !== 'string' || !id(item.dev) || !id(item.ino) || (item.kind === 'file' && !digest(item.sha256))) throw new Error('DESKTOP_SELECTION_SCHEMA');
        if (!canonical(item.path) || seen.has(item.path)) throw new Error('DESKTOP_STORE_CHANGED');
        seen.add(item.path); kinds.set(item.path, item.kind);
        const stat = fs.statSync(item.path);
        if (String(stat.dev) !== item.dev || String(stat.ino) !== item.ino || (item.kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) throw new Error('DESKTOP_STORE_CHANGED');
        if (item.kind === 'file' && (!/^[a-f0-9]{64}$/.test(item.sha256) || stat.size > 16 * 1024 * 1024 || hash(fs.readFileSync(item.path)) !== item.sha256)) throw new Error('DESKTOP_STORE_CONTENT_CHANGED');
    }
    // Existing database identity is a trusted chooser selection, never an
    // inferred new db. No SQLite/native module is loaded by this preflight.
    const database = descriptor.database;
    if (!database || !canonical(database.path)) throw new Error('DESKTOP_EXISTING_DATABASE_REQUIRED');
    const db = fs.statSync(database.path);
    if (!db.isFile() || db.size < 1 || String(db.dev) !== database.dev || String(db.ino) !== database.ino) throw new Error('DESKTOP_EXISTING_DATABASE_REQUIRED');
    // No absent-root/first-run inference or mkdir/chdir/env mutation. These two
    // anchors are required, NOT proof this list covers every product consumer.
    if (kinds.get(path.join(descriptor.cwd, 'silhouette.config.json')) !== 'file' || kinds.get(path.join(descriptor.cwd, 'db')) !== 'directory') throw new Error('DESKTOP_EXISTING_ANCHORS_REQUIRED');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(descriptor.cwd, name);
        if (fs.existsSync(file) && kinds.get(file) !== 'file') throw new Error('DESKTOP_ENV_FILE_NOT_SELECTED');
    }
    return Object.freeze({ cwd: descriptor.cwd });
}

export function verifyExistingSelection(descriptor, trustedDigest) {
    // Descriptor is trusted-source data, not an attacker object. Still normalize
    // all schema/filesystem/getter/serialization failures without property reads.
    try { return verify(descriptor, trustedDigest); }
    catch { throw new Error('DESKTOP_EXISTING_SELECTION_REJECTED'); }
}
