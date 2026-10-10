import fs from 'fs/promises';
import crypto from 'crypto';

export interface AtomicWriteOptions {
    /** Retries for transient rename failures (EPERM/EBUSY on Windows when another process holds the file). */
    renameRetries?: number;
    retryDelayMs?: number;
    /** Test seam. */
    rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Atomic file replacement: write to a temp file in the same directory, fsync it, rename over the target.
 * The target is either the old complete content or the new complete content, never a torn mix.
 * Transient rename errors are retried; if they persist the error is thrown and the target is left untouched
 * (the old non-atomic copyFile fallback could leave a half-written snapshot).
 */
export async function atomicWriteFile(target: string, data: string | Buffer, opts: AtomicWriteOptions = {}): Promise<void> {
    const retries = opts.renameRetries ?? 5;
    const delay = opts.retryDelayMs ?? 40;
    const rename = opts.rename ?? fs.rename;
    const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        const fh = await fs.open(tmp, 'w');
        try {
            await fh.writeFile(data);
            await fh.sync();
        } finally {
            await fh.close();
        }
        let lastErr: any;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                await rename(tmp, target);
                return;
            } catch (e: any) {
                lastErr = e;
                if (e?.code !== 'EPERM' && e?.code !== 'EBUSY' && e?.code !== 'EACCES') throw e;
                await new Promise(r => setTimeout(r, delay * (attempt + 1)));
            }
        }
        throw lastErr;
    } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
    }
}
