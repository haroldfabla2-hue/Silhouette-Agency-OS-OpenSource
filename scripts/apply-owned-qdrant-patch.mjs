/** Explicit installation-source preparation only. Does not import Qdrant.
 * Invoke from repo root after npm ci. Review candidate before wiring postinstall. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'patches/qdrant-1.17.0-owned-dispatcher.json'), 'utf8'));
const packageDir = path.join(root, 'node_modules/@qdrant/js-client-rest');
const metadata = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
if (metadata.name !== manifest.package || metadata.version !== manifest.version) throw new Error('Qdrant version mismatch; no patch applied');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
// Browser branch is intentionally unsupported/unchanged, with exact pinned evidence.
for (const file of manifest.unchangedBrowserFiles) {
    if (file.beforeSha256 !== file.afterSha256 || sha(fs.readFileSync(path.join(packageDir, file.path), 'utf8')) !== file.beforeSha256) throw new Error(`Unknown browser Qdrant bytes: ${file.path}; no patch applied`);
}
// Validate ALL originals/current patches and payloads before any write.
const plan = manifest.files.map(file => {
    const target = path.join(packageDir, file.path);
    const text = fs.readFileSync(target, 'utf8');
    const digest = sha(text);
    if (sha(file.afterText) !== file.afterSha256) throw new Error(`Patch payload mismatch: ${file.path}`);
    if (digest !== file.beforeSha256 && digest !== file.afterSha256) throw new Error(`Unknown Qdrant bytes: ${file.path}; no patch applied`);
    return { file, target, needed: digest === file.beforeSha256 };
});
for (const {file, target, needed} of plan) if (needed) {
    // Random private directory avoids PID reuse and concurrent writer collisions.
    // Only this invocation's exact file/directory is cleaned, never a glob.
    const privateDirectory = fs.mkdtempSync(path.join(path.dirname(target), '.ownership-patch-'));
    const temporary = path.join(privateDirectory, 'payload');
    try {
        fs.writeFileSync(temporary, file.afterText, { flag: 'wx' });
        const current = sha(fs.readFileSync(target, 'utf8'));
        if (current !== file.beforeSha256 && current !== file.afterSha256) throw new Error(`Concurrent Qdrant byte change: ${file.path}`);
        fs.renameSync(temporary, target);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        fs.rmdirSync(privateDirectory);
    }
}
for (const {file, target} of plan) if (sha(fs.readFileSync(target, 'utf8')) !== file.afterSha256) throw new Error(`Qdrant patch verification failed: ${file.path}`);
for (const file of manifest.unchangedBrowserFiles) if (sha(fs.readFileSync(path.join(packageDir, file.path), 'utf8')) !== file.afterSha256) throw new Error(`Browser bytes changed: ${file.path}`);
console.log('Pinned Qdrant ownership source patch verified. Runtime behavior is untested.');
