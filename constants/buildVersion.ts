/**
 * [R9] Single source of truth for the running build version.
 * Every surface (prompts, introspection, UI) reports THIS version - no more
 * persona "v2.0" vs introspection "v2.1.0" vs package "3.0.1" disagreements.
 * Read from package.json at module load; fallback is declared, not invented.
 */
import fs from 'fs';
import path from 'path';

function readVersion(): string {
    try {
        const pkgPath = path.resolve(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
    } catch { /* fall through */ }
    return 'unknown';
}

export const BUILD_VERSION: string = readVersion();
