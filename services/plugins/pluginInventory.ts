/** Deterministic source inventory BEFORE any computed plugin import.
 * Hashes identify bytes, not safety. Read/import TOCTOU and transitive imports remain
 * unverified: do not convert a manifest into a passivity or sandbox receipt. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export interface PluginSourceEntry { file: string; sha256: string | null; bytes: number | null; sourceStatus: 'REGULAR_SOURCE' | 'SYMLINK_UNVERIFIED' | 'NONREGULAR_UNVERIFIED' }
export interface PluginSourceInventory {
    directory: string;
    entries: PluginSourceEntry[];
    lifecycle: 'UNVERIFIED';
    reason: string;
}
const candidate = (file: string) => /\.(ts|js)$/.test(file) && !/\.d\.ts$|\.(test|spec)\.(ts|js)$/.test(file);
export async function inventoryPluginSources(directory: string): Promise<PluginSourceInventory> {
    const realDirectory = path.resolve(directory);
    let names: string[];
    try { names = await fs.readdir(realDirectory); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { directory: realDirectory, entries: [], lifecycle: 'UNVERIFIED', reason: 'No directory found at this observation; no import performed' };
        throw error;
    }
    const entries: PluginSourceEntry[] = [];
    for (const file of names.filter(candidate).sort()) {
        const target = path.join(realDirectory, file);
        const before = await fs.lstat(target);
        // Preserve legacy import behavior; inventory must not disable a plugin.
        // Do not read FIFOs/devices. Mark their source unverified before discovery
        // follows its existing import success/error path. Symlink targets stay unverified.
        if (!before.isFile() && !before.isSymbolicLink()) {
            entries.push({ file, sha256: null, bytes: null, sourceStatus: 'NONREGULAR_UNVERIFIED' });
            continue;
        }
        const targetStat = await fs.stat(target);
        if (!targetStat.isFile()) {
            entries.push({ file, sha256: null, bytes: null, sourceStatus: 'NONREGULAR_UNVERIFIED' });
            continue;
        }
        const bytes = await fs.readFile(target);
        const after = await fs.lstat(target);
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Plugin source changed during inventory: ${file}`);
        entries.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength, sourceStatus: before.isSymbolicLink() ? 'SYMLINK_UNVERIFIED' : 'REGULAR_SOURCE' });
    }
    return { directory: realDirectory, entries, lifecycle: 'UNVERIFIED', reason: 'Source-byte inventory only; no import or lifecycle behavior verified' };
}
