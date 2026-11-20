import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Fase-1 planner-contract fix: anchored edits. The planner used to demand
// FULL file contents it never saw (blind planning + token cap), which made
// whole-file rewrites of large files structural, not accidental (cycles
// 7700e173 / 1e93f209 / 48f77520). The contract is now the proven anchored
// edit format: every find must match the current file exactly once, the pure
// gates judge the post-edit content, and the executor applies the same
// verified edits to disk. Real throwaway git repo, real services, no mocks,
// no LLM calls.

let tmp: string;
let repo: string;
let worktree: string;
let selfdevDir: string;
let Service: typeof import('../../services/selfdev/cycleService');
const fixtureEnv=['SELF_REPO_UPSTREAM_URL','SELF_REPO_PATH','SELF_WORKTREE_PATH','SELFDEV_DIR'];
let savedEnv: Record<string,string|undefined>;

const bigFile = (marker: string) =>
    Array.from({ length: 100 }, (_, i) => `export const line_${i} = '${marker}-${i}';`).join('\n') + '\n';

describe('Operator preparation versus independent baseline verification (real worktrees)', () => {
    beforeEach(async () => {
        savedEnv=Object.fromEntries(fixtureEnv.map(name=>[name,process.env[name]]));
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfdev-edits-'));
        repo = path.join(tmp, 'repo');
        worktree = path.join(tmp, 'repo-selfwork');
        selfdevDir = path.join(tmp, 'selfdev');
        fs.mkdirSync(repo);
        fs.mkdirSync(path.join(repo, 'services'));
        execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
        execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
        execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
        fs.writeFileSync(path.join(repo, 'services', 'target.ts'), bigFile('alpha'));
        fs.writeFileSync(path.join(repo, 'services', 'victim.ts'), bigFile('beta'));
        // Authored, immutable fixture oracle, not a production learning oracle.
        // Existing target baseline and unchanged helper/runner are real Vitest inputs.
        fs.mkdirSync(path.join(repo, 'tests'));
        fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');
        fs.writeFileSync(path.join(repo, 'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',skipLibCheck:true,noEmit:true,types:[]},include:['services/**/*.ts']}));
        fs.writeFileSync(path.join(repo, 'package.json'), '{"type":"module","private":true}');
        fs.writeFileSync(path.join(repo, 'vitest.config.ts'), "export default {test:{include:['tests/*.test.ts'],retry:0,pool:'forks',maxWorkers:1}};");
        fs.writeFileSync(path.join(repo, 'tests/acceptance.test.ts'), `import {test,expect} from 'vitest';
import * as target from '../services/target';
import fs from 'node:fs';
test('unchanged target invariants and whole new file',()=>{
 expect(target.line_99).toBe('alpha-99');
 expect(['alpha-50','edited']).toContain(target.line_50);
 const fresh='services/newfile.ts';
 if(fs.existsSync(fresh))expect(fs.readFileSync(fresh,'utf8')).toBe('export const fresh = true;\\n');
});`);
        fs.writeFileSync(path.join(repo, 'tests/selfdev-oracles.json'), JSON.stringify({version:1,oracles:[{
            target:'tests/acceptance.test.ts',oracleFiles:['tests/acceptance.test.ts'],
            codeUnderTest:['services/target.ts','services/newfile.ts']
        }]}));
        execFileSync('git', ['add', '-A'], { cwd: repo });
        fs.symlinkSync(fs.realpathSync('node_modules'), path.join(repo, 'node_modules'), 'dir');
        execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

        process.env.SELF_REPO_UPSTREAM_URL = repo;
        process.env.SELF_REPO_PATH = repo;
        process.env.SELF_WORKTREE_PATH = worktree;
        process.env.SELFDEV_DIR = selfdevDir;

        Service = await import('../../services/selfdev/cycleService');
    });

    afterEach(() => {
        try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo }); } catch { /* best effort */ }
        fs.rmSync(tmp, { recursive: true, force: true });
        for(const name of fixtureEnv){if(savedEnv[name]===undefined)delete process.env[name];else process.env[name]=savedEnv[name];}
    });

    const fresh = (name: string) => {
        const dir = path.join(selfdevDir, name);
        fs.mkdirSync(dir, { recursive: true });
        return new Service.SelfDevCycleService({ dir });
    };

    it('executes an anchored edit end-to-end and the gates see the post-edit content', async () => {
        const s = fresh('happy');
        const c = s.create({ issue: 'surgical fix', scope: ['services'], acceptance: { kind: 'vitest', target: 'tests/acceptance.test.ts' } });
        await s.attempt(c.id, [{ op: 'edit', path: 'services/target.ts', edits: [{ find: "export const line_50 = 'alpha-50';", replace: "export const line_50 = 'edited';" }], rationale: 'fix line 50 only' }]);
        const ex = await s.execute(c.id, { authenticatedOperator: true });
        const onDisk = fs.readFileSync(path.join(worktree, 'services', 'target.ts'), 'utf8');
        expect(onDisk).toContain("line_50 = 'edited'");
        expect(onDisk).toContain("line_99 = 'alpha-99'"); // the other 99 lines untouched
        expect(ex.state).toBe('VERIFIED');
        expect(ex.lastError).toBeUndefined();
        expect(ex.evaluation?.verdict).toBe('preserved');
        expect(ex.runs.filter(run => run.kind === 'vitest')).toHaveLength(2);
        expect(ex.runs.every(run => run.pass && run.code === 0)).toBe(true);
    }, 60000);

    it('unsupported trusted-evaluation paths prepare explicit operator patches for review only', async () => {
        const s = fresh('unsupported');
        const c = s.create({ issue:'unsupported src workflow',scope:['src'],acceptance:{kind:'vitest',target:'tests/acceptance.test.ts'} });
        await s.attempt(c.id,[{op:'write',path:'src/new.ts',content:'export const unchanged = true;\n',rationale:'fixture'}]);
        const ex=await s.execute(c.id, { authenticatedOperator: true });
        expect(ex.state).toBe('EXECUTED');
        expect(ex.lastError).toMatch(/OPERATOR_REVIEW_REQUIRED.*EVALUATION_ORACLE_SCOPE/);
        expect(fs.readFileSync(path.join(worktree,'src/new.ts'),'utf8')).toContain('unchanged = true');
        expect(ex.evaluation).toBeUndefined();
        expect(()=>s.requestPR(c.id,'fixture-reviewer')).toThrow(/baseline-bound/);
        expect(ex.runs).toHaveLength(0);
        expect(s.list().find(row=>row.id===c.id)?.lastError).toBe(ex.lastError);
        expect(new Service.SelfDevCycleService({dir:path.join(selfdevDir,'unsupported')}).get(c.id).lastError).toBe(ex.lastError);
    });

    it('missing independent baseline allows only explicit operator preparation', async () => {
        const s = fresh('missing-baseline');
        const c = s.create({issue:'missing test',scope:['services'],acceptance:{kind:'vitest',target:'tests/absent.test.ts'}});
        await s.attempt(c.id,[{op:'write',path:'services/newfile.ts',content:'export const fresh = true;\n',rationale:'fixture'}]);
        const ex=await s.execute(c.id, { authenticatedOperator: true });
        expect(ex.state).toBe('EXECUTED');
        expect(ex.lastError).toMatch(/OPERATOR_REVIEW_REQUIRED.*BASELINE_EVALUATION_UNAVAILABLE/);
        expect(fs.readFileSync(path.join(worktree,'services/newfile.ts'),'utf8')).toContain('fresh = true');
        expect(ex.evaluation).toBeUndefined();
        expect(()=>s.requestPR(c.id,'fixture-reviewer')).toThrow(/baseline-bound/);
        expect(ex.runs).toHaveLength(0);
    });

    it('explicit operator UI patches are prepared without trusting edited acceptance', async () => {
        const s=fresh('ui-preparation');
        const c=s.create({issue:'UI change',scope:['components'],acceptance:{kind:'vitest',target:'tests/acceptance.test.ts'}});
        await s.attempt(c.id,[{op:'write',path:'components/Panel.tsx',content:'export const Panel=()=>null;\n',rationale:'fixture'}]);
        const ex=await s.execute(c.id,{authenticatedOperator:true});
        expect(ex.state).toBe('EXECUTED');expect(ex.lastError).toMatch(/OPERATOR_REVIEW_REQUIRED/);
        expect(fs.readFileSync(path.join(worktree,'components/Panel.tsx'),'utf8')).toBe('export const Panel=()=>null;\n');
        expect(ex.evaluation).toBeUndefined();expect(ex.runs).toHaveLength(0);
        expect(()=>s.requestPR(c.id,'fixture-reviewer')).toThrow(/baseline-bound/);
    });

    it('a source claim alone grants no operator preparation authority', async () => {
        const s=fresh('source-claim');
        const c=s.create({issue:'source claim',scope:['src'],acceptance:{kind:'vitest',target:'tests/absent.test.ts'}});
        await s.attempt(c.id,[{op:'write',path:'src/unapproved.ts',content:'export const claimed=true;',rationale:'fixture'}]);
        expect(c.patch?.source).toBe('operator');
        const ex=await s.execute(c.id);
        expect(ex.state).toBe('ATTEMPTED');expect(ex.lastError).toMatch(/no candidate written/);
        expect(fs.existsSync(path.join(worktree,'src/unapproved.ts'))).toBe(false);
    });

    it('autonomous missing-baseline cannot use operator preparation', async () => {
        const s=fresh('autonomous');
        const c=s.create({issue:'missing independent baseline',scope:['services'],acceptance:{kind:'vitest',target:'tests/absent.test.ts'}});
        await s.attempt(c.id,[{op:'write',path:'services/newfile.ts',content:'export const fresh = true;\n',rationale:'fixture'}]);
        // This assigns only provenance to exercise the exact execute guard, not
        // a fake runner or fabricated provider response. No LLM is invoked.
        c.patch!.source='llm';
        const ex=await s.execute(c.id,{authenticatedOperator:true});
        expect(ex.state).toBe('ATTEMPTED');expect(ex.lastError).toMatch(/BASELINE_EVALUATION_UNAVAILABLE.*no candidate written/);
        expect(fs.existsSync(path.join(worktree,'services/newfile.ts'))).toBe(false);
    });

    it('supported new files land whole and retain an unchanged baseline oracle', async () => {
        const s = fresh('write-compat');
        const c = s.create({ issue: 'new file', scope: ['services'], acceptance: { kind: 'vitest', target: 'tests/acceptance.test.ts' } });
        await s.attempt(c.id, [{ op: 'write', path: 'services/newfile.ts', content: 'export const fresh = true;\n', rationale: 'add new module' }]);
        const ex = await s.execute(c.id, { authenticatedOperator: true });
        expect(ex.state).toBe('VERIFIED');
        expect(ex.evaluation?.verdict).toBe('preserved');
        expect(ex.runs.filter(run => run.kind === 'vitest')).toHaveLength(2);
        expect(fs.readFileSync(path.join(worktree, 'services', 'newfile.ts'), 'utf8')).toContain('fresh = true');
    }, 60000);
});
