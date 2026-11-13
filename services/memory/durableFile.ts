/** Synchronous durability boundary. No sidecar/control files may use these
 * helpers: their descriptors belong exclusively to SQLite's locking protocol.
 * POSIX directory fsync is explicit; Windows has no equivalent here.
 * Successful fsync is an OS/filesystem contract, not a hardware power-loss test.
 */
import fs from 'node:fs';
import path from 'node:path';

function withDescriptor(file: string, flags: string, work: (fd: number) => void): void {
    const fd = fs.openSync(file, flags);
    try { work(fd); }
    catch (error) {
        try { fs.closeSync(fd); } catch (closeError) {
            console.error('[DURABLE_FILE] Secondary close failure:', closeError);
        }
        throw error;
    }
    fs.closeSync(fd);
}

/** Sync the directory and its ancestors, including previously-created parents
 * from an earlier failed attempt. No assumptions about which mkdir won a race.
 * Cost is unmeasured; do not describe this as free or negligible.
 */
function syncDirectoryLineage(directory: string): void {
    if (process.platform === 'win32') return;
    let current = path.resolve(directory);
    for (;;) {
        withDescriptor(current, 'r', fd => fs.fsyncSync(fd));
        const parent = path.dirname(current);
        if (parent === current) return;
        current = parent;
    }
}

export function durableDirectory(directory: string): void {
    fs.mkdirSync(directory, { recursive: true });
    syncDirectoryLineage(directory);
}

export function appendDurable(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    withDescriptor(file, 'a', fd => {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
    });
    syncDirectoryLineage(path.dirname(file));
}

/** A marker left visible by a previous failed commit still needs this fence.
 * r+ refuses an absent/read-only receipt rather than creating a phantom one.
 */
export function syncExistingDurable(file: string): void {
    withDescriptor(file, 'r+', fd => fs.fsyncSync(fd));
    syncDirectoryLineage(path.dirname(file));
}
