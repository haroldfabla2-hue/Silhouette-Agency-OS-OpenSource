/** Actual electron-builder resource copying and SQLite. Not an Electron launch. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { verifiedMigrationAssets } from '../../services/migrationAssets';
const require = createRequire(import.meta.url);
const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher.js');
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
const names = ['001_baseline_indexes.down.sql', '001_baseline_indexes.up.sql', '002_facts_table.down.sql', '002_facts_table.up.sql', '003_user_profiles.down.sql', '003_user_profiles.up.sql', '004_incidents.down.sql', '004_incidents.up.sql'];
describe('desktop SQLite migration resources', () => {
    it('copies exactly owning SQL bytes outside app.asar with actual builder matchers', async () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-assets-'));
        try {
            const fixture = path.join(temp, 'source');
            const source = path.join(fixture, 'db/migrations/sqlite');
            fs.mkdirSync(path.dirname(source), { recursive: true });
            fs.cpSync(path.join(root, 'db/migrations/sqlite'), source, { recursive: true });
            fs.writeFileSync(path.join(source, 'private-dump.sql'), 'do not package');
            fs.mkdirSync(path.join(source, 'nested'));
            fs.writeFileSync(path.join(source, 'nested/dump.sql'), 'do not package');
            const resource = config.extraResources.find((entry: any) => entry.from === 'db/migrations/sqlite');
            expect(resource).toEqual({ from: 'db/migrations/sqlite', to: 'migrations/sqlite', filter: names });
            const destination = path.join(temp, 'resources');
            const matchers = getFileMatchers({ extraResources: [resource] }, 'extraResources', destination, {
                defaultSrc: fixture, globalOutDir: path.join(temp, 'out'), macroExpander: (s: string) => s, customBuildOptions: {}
            });
            await copyFiles(matchers, null, false);
            const assets = path.join(destination, 'migrations/sqlite');
            expect(fs.readdirSync(assets).sort()).toEqual(names);
            expect(verifiedMigrationAssets(assets)).toHaveLength(4);
            for (const name of names) expect(fs.readFileSync(path.join(assets, name))).toEqual(fs.readFileSync(path.join(source, name)));
            // An actual non-Electron Node child opens the real service using only
            // copied resource assets and an unrelated writable cwd.
            const cwd = path.join(temp, 'arbitrary-cwd'); fs.mkdirSync(cwd);
            const service = pathToFileURL(path.join(root, 'services/sqliteService.ts')).href;
            const child = spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '-e', `import(${JSON.stringify(service)}).then(({sqliteService:s})=>{try{const versions=s.db.prepare('SELECT version FROM system_migrations ORDER BY version').all().map(x=>x.version);if(JSON.stringify(versions)!=='["001","002","003","004"]')throw Error('wrong versions');console.log('RESOURCE_SQLITE_OK')}finally{s.close()}}).catch(e=>{console.error(e);process.exitCode=1})`], {
                cwd, encoding: 'utf8', timeout: 20000,
                env: { PATH: process.env.PATH, HOME: cwd, SILHOUETTE_PROVIDERS: 'off', SILHOUETTE_MIGRATIONS_DIR: assets }
            });
            expect(child.status, child.stderr).toBe(0); expect(child.stdout).toContain('RESOURCE_SQLITE_OK');
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    });
    it('packaged server spawn selects resources SQL, not caller cwd or development assets', () => {
        const source = fs.readFileSync(path.join(root, 'electron.cjs'), 'utf8');
        const ast = ts.createSourceFile('electron.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const found: string[] = [];
        function visit(node: ts.Node) {
            if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'SILHOUETTE_MIGRATIONS_DIR') {
                expect(node.parent.parent.getText(ast).startsWith('env:')).toBe(true);
                const call = node.parent.parent.parent.parent;
                expect(ts.isCallExpression(call)).toBe(true);
                if (ts.isCallExpression(call)) {
                    expect(call.expression.getText(ast)).toBe('spawn');
                    expect(call.arguments[0].getText(ast)).toBe("'node'");
                    expect(call.arguments[1].getText(ast)).toBe('[serverPath]');
                }
                found.push(node.initializer.getText(ast));
            }
            ts.forEachChild(node, visit);
        }
        visit(ast);
        expect(found).toEqual(["path.join(process.resourcesPath, 'migrations', 'sqlite')"]);
        // This is source wiring verification, not packaged app startup proof.
    });
});
