import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifiedMigrationAssets } from '../../services/migrationAssets';

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'db/migrations/sqlite');
const ups = ['001_baseline_indexes.up.sql', '002_facts_table.up.sql', '003_user_profiles.up.sql', '004_incidents.up.sql'];
function fixture(run: (dir: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sil-assets-'));
    try { run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function seed(dir: string) { fs.cpSync(assets, dir, { recursive: true }); }
function child(script: string, dir: string, sqlDir: string) {
    return spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '-e', script], {
        cwd: dir, timeout: 20000, encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: dir, SILHOUETTE_PROVIDERS: 'off', SILHOUETTE_INFERENCE_MODE: 'cloud-only',
            SILHOUETTE_DB_PATH: path.join(dir, 'store/test.sqlite'), SILHOUETTE_MIGRATIONS_DIR: sqlDir }
    });
}
const serviceUrl = pathToFileURL(path.join(root, 'services/sqliteService.ts')).href;
describe('immutable SQLite migration assets', () => {
    it('accepts exactly the owning eight SQL files and ordered four ups', () => fixture(dir => {
        seed(dir); expect(verifiedMigrationAssets(dir)).toEqual(ups);
    }));
    it('does not create a missing directory', () => fixture(dir => {
        const missing = path.join(dir, 'missing');
        expect(() => verifiedMigrationAssets(missing)).toThrow(); expect(fs.existsSync(missing)).toBe(false);
    }));
    it('rejects empty and down-only directories', () => fixture(dir => {
        expect(() => verifiedMigrationAssets(dir)).toThrow(/set mismatch/); seed(dir);
        for (const name of ups) fs.unlinkSync(path.join(dir, name));
        expect(() => verifiedMigrationAssets(dir)).toThrow(/set mismatch/);
    }));
    it('rejects extra and missing SQL', () => fixture(dir => {
        seed(dir); const extra = path.join(dir, 'dump.sql'); fs.writeFileSync(extra, 'SELECT 1');
        expect(() => verifiedMigrationAssets(dir)).toThrow(/set mismatch/); fs.unlinkSync(extra);
        fs.unlinkSync(path.join(dir, ups[0])); expect(() => verifiedMigrationAssets(dir)).toThrow(/set mismatch/);
    }));
    it('rejects changed bytes and symlinks', () => fixture(dir => {
        seed(dir); const file = path.join(dir, ups[0]); fs.appendFileSync(file, '\n-- changed');
        expect(() => verifiedMigrationAssets(dir)).toThrow(/hash mismatch/); fs.unlinkSync(file);
        fs.symlinkSync(path.join(assets, ups[0]), file);
        expect(() => verifiedMigrationAssets(dir)).toThrow(/not a regular file/);
    }));
    it('actual eager singleton rejects missing assets before creating DB directory', () => fixture(dir => {
        const result = child(`import(${JSON.stringify(serviceUrl)}).then(()=>{process.exitCode=2}).catch(e=>{if(e.code!=='ENOENT'||e.path!==process.env.SILHOUETTE_MIGRATIONS_DIR){console.error(e);process.exitCode=1}else console.log('ASSET_REJECTED')})`, dir, path.join(dir, 'missing'));
        expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('ASSET_REJECTED');
        expect(fs.existsSync(path.join(dir, 'store'))).toBe(false);
    }));
    it('actual provider-OFF scrub preserves the configured migration asset path', () => fixture(dir => {
        const credentialsUrl = pathToFileURL(path.join(root, 'server/config/runtimeCredentials.ts')).href;
        const result = child(`import(${JSON.stringify(credentialsUrl)}).then(({loadRuntimeEnvironment})=>{const expected=process.env.SILHOUETTE_MIGRATIONS_DIR;loadRuntimeEnvironment();if(process.env.SILHOUETTE_MIGRATIONS_DIR!==expected)throw Error('asset path scrubbed');return import(${JSON.stringify(serviceUrl)})}).then(({sqliteService:s})=>{s.close();console.log('OFF_PATH_OK')}).catch(e=>{console.error(e);process.exitCode=1})`, dir, assets);
        expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('OFF_PATH_OK');
    }));
    it('actual singleton preserves config across process close/reopen with explicit assets', () => fixture(dir => {
        const first = child(`import(${JSON.stringify(serviceUrl)}).then(({sqliteService:s})=>{try{s.setConfig('asset-proof',{retained:true})}finally{s.close()}}).catch(e=>{console.error(e);process.exitCode=1})`, dir, assets);
        expect(first.status, first.stderr).toBe(0);
        const second = child(`import(${JSON.stringify(serviceUrl)}).then(({sqliteService:s})=>{try{if(s.getConfig('asset-proof')?.retained!==true)throw Error('lost config');console.log('REOPEN_OK')}finally{s.close()}}).catch(e=>{console.error(e);process.exitCode=1})`, dir, assets);
        expect(second.status, second.stderr).toBe(0); expect(second.stdout).toContain('REOPEN_OK');
    }));
});
