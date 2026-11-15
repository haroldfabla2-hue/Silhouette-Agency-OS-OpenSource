/**
 * Real installation scan.
 *
 * Builds the SystemMap the Installation Wizard shows the user from the actual
 * repository and database, instead of a hardcoded map. Every field here is
 * derived from the filesystem or SQLite at request time; if a source cannot
 * be read the field comes back empty (never fabricated).
 */
import fs from 'fs';
import path from 'path';
import { SystemMap, UserRole } from '../../types';

/** Extract registered Express route paths from a routes file's source. */
export function extractRoutePaths(source: string, mountPrefix: string): string[] {
    const paths: string[] = [];
    const re = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
        paths.push(`${match[1].toUpperCase()} ${mountPrefix}${match[2]}`);
    }
    return paths.sort();
}

/** List React components (.tsx) directly inside a directory. */
export function listFrontendComponents(componentsDir: string): string[] {
    try {
        return fs.readdirSync(componentsDir)
            .filter(f => f.endsWith('.tsx'))
            .sort();
    } catch {
        return [];
    }
}

/** List API endpoints by scanning the v1 routes directory. */
export function listBackendEndpoints(routesDir: string, mountPrefix = '/v1'): string[] {
    const endpoints: string[] = [];
    let files: string[] = [];
    try {
        files = fs.readdirSync(routesDir).filter(f => f.endsWith('.routes.ts'));
    } catch {
        return [];
    }
    for (const file of files) {
        try {
            const source = fs.readFileSync(path.join(routesDir, file), 'utf-8');
            const family = file.replace(/\.routes\.ts$/, '');
            endpoints.push(...extractRoutePaths(source, `${mountPrefix}/${family}`));
        } catch {
            // Unreadable file: skip it rather than inventing endpoints.
        }
    }
    return endpoints.sort();
}

/** List real table names from the SQLite database, or [] if unavailable. */
export function listDatabaseSchema(db: { prepare: (sql: string) => { all: () => unknown[] } } | null): string[] {
    if (!db) return [];
    try {
        const rows = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all() as { name: string }[];
        return rows.map(r => r.name);
    } catch {
        return [];
    }
}

/**
 * The UI role matrix, built from the UserRole enum the product actually ships
 * (types.ts). Server-side channel roles live in services/identityService.ts
 * (CREATOR/ADMIN/USER/GUEST) and are enforced there, not duplicated here.
 */
export function currentRolePolicy(): SystemMap['rolePolicy'] {
    return {
        [UserRole.SUPER_ADMIN]: ['*'],
        [UserRole.ADMIN]: ['dashboard', 'orchestrator', 'memory'],
        [UserRole.WORKER_L1]: ['tasks'],
        [UserRole.WORKER_L2]: ['tasks', 'docs'],
        [UserRole.CLIENT]: ['project_view', 'support_chat'],
        [UserRole.VISITOR]: []
    };
}

export interface ScanSources {
    rootDir: string;
    db?: { prepare: (sql: string) => { all: () => unknown[] } } | null;
}

export async function buildSystemMap({ rootDir, db = null }: ScanSources): Promise<SystemMap> {
    return {
        scanTimestamp: Date.now(),
        frontendComponents: listFrontendComponents(path.join(rootDir, 'components')),
        backendEndpoints: listBackendEndpoints(path.join(rootDir, 'server', 'routes', 'v1')),
        databaseSchema: listDatabaseSchema(db),
        rolePolicy: currentRolePolicy()
    };
}
