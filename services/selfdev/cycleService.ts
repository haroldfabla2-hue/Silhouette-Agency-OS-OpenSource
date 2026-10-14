/**
 * SELF-DEV CYCLE SERVICE — Wave 2, P0
 * ═══════════════════════════════════════════════════════════════
 * Full self-improvement cycle: issue -> change -> tests -> real
 * verification -> operator-approved PR.
 *
 * State machine (persisted + journaled):
 *   PLANNED -> ATTEMPTED -> EXECUTED -> VERIFIED
 *     -> PR_SUBMITTED -> PR_OPEN
 *   Terminals: PR_OPEN, FAILED, REJECTED, ABANDONED.
 *
 * Guardrails:
 *  - File mutations are confined to the isolated selfwork clone via
 *    selfCodeService (F2). This service never touches the running tree.
 *  - Verification is real: the acceptance vitest target runs INSIDE the
 *    clone and is executed TWICE (flake guard); both runs must pass.
 *    CI on the resulting PR remains the full gate (tsc + full suite).
 *  - PR creation is world-exiting: it requires operator approval
 *    (approvedBy, same pattern as F4) and is executed by the root
 *    publisher helper (scripts/selfdev-pr-publisher.sh) through a
 *    handoff file. This service never pushes code itself.
 *  - Persistence: atomic state file (tmp+fsync+rename; a corrupt state
 *    file is quarantined, never deleted) plus an append-only journal.
 *  - One active cycle at a time: the selfwork clone is shared, so a new
 *    cycle cannot be created while another is non-terminal.
 *  - Caps are env-driven, nothing hardcoded: SELFDEV_MAX_CYCLES_PER_DAY,
 *    SELFDEV_MAX_OPS, SELFDEV_MAX_PATCH_BYTES, SELFDEV_DIR.
 */

import { applyCycleEdits, checkScope, checkShrink, CycleEdit, GateOp } from './gates';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { selfCodeService } from '../selfCodeService';
import { llmGateway, CompletionOptions } from '../llmGateway';

export type CycleState =
    | 'PLANNED' | 'ATTEMPTED' | 'EXECUTED' | 'VERIFIED'
    | 'PR_SUBMITTED' | 'PR_OPEN'
    | 'FAILED' | 'REJECTED' | 'ABANDONED';

export interface CycleOp {
    op: 'write' | 'edit';
    path: string;        // repo-relative path inside the selfwork clone
    content?: string;    // write ops (new files): full content
    edits?: CycleEdit[]; // edit ops (existing files): anchored replacements
    rationale: string;
}

export interface CycleRun {
    kind: 'vitest' | 'tsc' | 'route-smoke';
    target: string;
    code: number;
    pass: boolean;
    outputTail: string;
    at: string;
}

export interface CycleTransition { from: CycleState | null; to: CycleState; at: string; note?: string; }

export interface SelfDevCycle {
    id: string;
    issue: string;
    scope: string[];                              // allowed repo-relative path prefixes
    acceptance: { kind: 'vitest'; target: string };
    state: CycleState;
    patch?: { source: 'operator' | 'llm'; ops: CycleOp[] };
    diff?: string;
    runs: CycleRun[];
    pr?: { approvedBy: string; requestedAt: string; url?: string; number?: number };
    outcome?: { state: 'merged' | 'closed-unmerged' | 'open'; mergedAt?: string; closedAt?: string; syncedAt: string };
    lastError?: string;
    createdAt: string;
    updatedAt: string;
    history: CycleTransition[];
}

interface CycleStore { cycles: SelfDevCycle[]; }

const ACTIVE_STATES: CycleState[] = ['PLANNED', 'ATTEMPTED', 'EXECUTED', 'VERIFIED', 'PR_SUBMITTED'];

export class SelfDevCycleService {
    private dir: string;
    private maxCyclesPerDay: number;
    private maxOps: number;
    private maxPatchBytes: number;
    private store: CycleStore;

    constructor(opts?: { dir?: string }) {
        const env = process.env;
        this.dir = opts?.dir ?? env.SELFDEV_DIR ?? path.resolve(process.cwd(), 'data', 'selfdev');
        this.maxCyclesPerDay = Number(env.SELFDEV_MAX_CYCLES_PER_DAY ?? 5);
        this.maxOps = Number(env.SELFDEV_MAX_OPS ?? 20);
        this.maxPatchBytes = Number(env.SELFDEV_MAX_PATCH_BYTES ?? 65536);
        fs.mkdirSync(this.requestsDir(), { recursive: true });
        fs.mkdirSync(this.resultsDir(), { recursive: true });
        this.store = this.load();
    }

    // ---------- persistence ----------

    private statePath() { return path.join(this.dir, 'cycles.json'); }
    private journalPath() { return path.join(this.dir, 'cycles.journal.jsonl'); }
    private requestsDir() { return path.join(this.dir, 'pr-requests'); }
    private resultsDir() { return path.join(this.dir, 'pr-results'); }

    private load(): CycleStore {
        const p = this.statePath();
        if (!fs.existsSync(p)) return { cycles: [] };
        try {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!parsed || !Array.isArray(parsed.cycles)) throw new Error('bad shape');
            return parsed as CycleStore;
        } catch (err) {
            // Eternal-memory invariant: quarantine, never delete.
            const q = `${p}.corrupt-${Date.now()}`;
            fs.renameSync(p, q);
            this.journal({ ts: new Date().toISOString(), event: 'STATE_QUARANTINED', detail: `corrupt cycles.json moved to ${path.basename(q)}` });
            return { cycles: [] };
        }
    }

    private save() {
        const tmp = `${this.statePath()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), 'utf-8');
        const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd);
        fs.renameSync(tmp, this.statePath());
    }

    private journal(entry: Record<string, unknown>) {
        const line = JSON.stringify(entry) + '\n';
        const fd = fs.openSync(this.journalPath(), 'a');
        fs.writeSync(fd, line); fs.fsyncSync(fd); fs.closeSync(fd);
    }

    private transition(c: SelfDevCycle, to: CycleState, note?: string) {
        const at = new Date().toISOString();
        c.history.push({ from: c.state, to, at, note });
        c.state = to; c.updatedAt = at;
        this.journal({ ts: at, cycleId: c.id, event: 'TRANSITION', to, note });
        this.save();
    }

    private get(id: string): SelfDevCycle {
        const c = this.store.cycles.find(x => x.id === id);
        if (!c) throw Object.assign(new Error('cycle not found'), { statusCode: 404 });
        return c;
    }

    // ---------- validation ----------

    private static validRel(p: string) { return typeof p === 'string' && p.length > 0 && !path.isAbsolute(p) && !p.split('/').includes('..'); }

    private validateOps(ops: CycleOp[], scope: string[]) {
        if (!Array.isArray(ops) || ops.length === 0) throw new Error('ops must be a non-empty array');
        if (ops.length > this.maxOps) throw new Error(`too many ops (max ${this.maxOps})`);
        let total = 0;
        for (const o of ops) {
            if (o.op !== 'write' && o.op !== 'edit') throw new Error(`unsupported op: ${String(o.op)} (supports write + edit)`);
            if (!SelfDevCycleService.validRel(o.path)) throw new Error(`invalid path: ${String(o.path)}`);
            if (!scope.some(s => o.path === s || o.path.startsWith(s.endsWith('/') ? s : s + '/'))) {
                throw new Error(`path outside declared cycle scope: ${o.path}`);
            }
            if (typeof o.rationale !== 'string' || !o.rationale.trim()) {
                throw new Error(`op ${o.path}: non-empty rationale is required`);
            }
            if (o.op === 'write') {
                if (typeof o.content !== 'string') throw new Error(`op ${o.path}: write requires content`);
                total += Buffer.byteLength(o.content, 'utf8');
            } else {
                if (!Array.isArray(o.edits) || o.edits.length === 0) throw new Error(`op ${o.path}: edit requires a non-empty edits array`);
                for (const e of o.edits) {
                    if (!e || typeof e.find !== 'string' || e.find.length === 0) throw new Error(`op ${o.path}: every edit needs a non-empty find`);
                    if (typeof e.replace !== 'string') throw new Error(`op ${o.path}: every edit needs a string replace`);
                    total += Buffer.byteLength(e.find, 'utf8') + Buffer.byteLength(e.replace, 'utf8');
                }
            }
        }
        if (total > this.maxPatchBytes) throw new Error(`patch too large (${total} bytes, max ${this.maxPatchBytes})`);
    }

    // ---------- API ----------

    public list() {
        return this.store.cycles.map(c => ({ id: c.id, issue: c.issue, state: c.state, updatedAt: c.updatedAt, pr: c.pr }));
    }

    public create(input: { issue?: string; scope?: string[]; acceptance?: { kind?: string; target?: string } }): SelfDevCycle {
        const issue = (input.issue ?? '').trim();
        if (!issue) throw Object.assign(new Error('issue is required'), { statusCode: 400 });
        const scope = input.scope ?? [];
        if (!Array.isArray(scope) || scope.length === 0 || !scope.every(SelfDevCycleService.validRel)) {
            throw Object.assign(new Error('scope must be a non-empty array of repo-relative path prefixes'), { statusCode: 400 });
        }
        const kind = input.acceptance?.kind ?? 'vitest';
        const target = input.acceptance?.target ?? '';
        if (kind !== 'vitest' || !SelfDevCycleService.validRel(target)) {
            throw Object.assign(new Error('acceptance must be { kind: "vitest", target: <relative test path> }'), { statusCode: 400 });
        }
        if (this.store.cycles.some(c => ACTIVE_STATES.includes(c.state))) {
            throw Object.assign(new Error('another cycle is already active (shared selfwork clone): finish or abandon it first'), { statusCode: 409 });
        }
        const today = new Date().toISOString().slice(0, 10);
        const todays = this.store.cycles.filter(c => c.createdAt.startsWith(today)).length;
        if (todays >= this.maxCyclesPerDay) {
            throw Object.assign(new Error(`daily cycle cap reached (${this.maxCyclesPerDay})`), { statusCode: 429 });
        }
        const at = new Date().toISOString();
        const c: SelfDevCycle = {
            id: crypto.randomUUID(), issue, scope, acceptance: { kind: 'vitest', target },
            state: 'PLANNED', runs: [], createdAt: at, updatedAt: at,
            history: [{ from: null, to: 'PLANNED', at, note: 'cycle created' }]
        };
        this.store.cycles.push(c);
        this.journal({ ts: at, cycleId: c.id, event: 'CREATED', issue, scope, acceptance: c.acceptance });
        this.save();
        return c;
    }

    public async attempt(id: string, ops?: CycleOp[]): Promise<SelfDevCycle> {
        // Freshness sync (best effort): the planner should see current code.
        // If the sync is unavailable here, execute() still hard-blocks any
        // VERIFIED without a fresh worktree, so a stale plan can never be
        // promoted - it just gets caught by the gates later.
        try {
            await selfCodeService.syncWithUpstream();
        } catch (err) {
            this.journal({ ts: new Date().toISOString(), cycleId: id, event: 'ERROR', detail: `worktree sync unavailable at attempt: ${(err as Error).message}` });
        }

        const c = this.get(id);
        if (c.state !== 'PLANNED') throw Object.assign(new Error(`attempt requires PLANNED (current: ${c.state})`), { statusCode: 409 });
        let source: 'operator' | 'llm';
        let finalOps: CycleOp[];
        if (ops) {
            source = 'operator';
            finalOps = ops;
        } else {
            source = 'llm';
            try {
                finalOps = await this.planWithLLM(c);
            } catch (err) {
                c.lastError = `planner unavailable or invalid plan: ${(err as Error).message}`;
                c.updatedAt = new Date().toISOString();
                this.journal({ ts: c.updatedAt, cycleId: c.id, event: 'ERROR', detail: c.lastError });
                this.save();
                return c; // stays PLANNED, honestly
            }
        }
        try {
            this.validateOps(finalOps, c.scope);
        } catch (err) {
            c.lastError = `invalid plan: ${(err as Error).message}`;
            c.updatedAt = new Date().toISOString();
            this.journal({ ts: c.updatedAt, cycleId: c.id, event: 'ERROR', detail: c.lastError });
            this.save();
            return c;
        }
        delete c.lastError;
        c.patch = { source, ops: finalOps };
        this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'PATCH_PROPOSED', source, paths: finalOps.map(o => o.path) });
        this.transition(c, 'ATTEMPTED', `patch proposed by ${source} (${finalOps.length} ops)`);
        return c;
    }

    private async planWithLLM(c: SelfDevCycle): Promise<CycleOp[]> {
        // Ground the planner in the CURRENT files (worktree is synced before
        // attempt). A planner that never sees the code hallucinates both the
        // old and the new version; that blindness plus a full-file-write
        // contract is what produced destructive whole-file rewrites.
        const MAX_GROUNDING_BYTES = 150_000;
        const files: string[] = [];
        let budget = MAX_GROUNDING_BYTES;
        for (const entry of c.scope) {
            try {
                const r = await selfCodeService.readFile(entry);
                if (r.content.length <= budget) {
                    files.push(`--- CURRENT ${r.path} ---\n${r.content}`);
                    budget -= r.content.length;
                }
            } catch { /* scope dir or not-yet-existing file: nothing to ground */ }
        }
        const base = [
            'You are the planning step of a guarded self-improvement cycle for the Silhouette codebase.',
            'You are given the CURRENT content of every existing in-scope file. Never invent code you cannot see.',
            'Respond with STRICT JSON only: {"ops":[{"op":"edit","path":"<repo-relative>","edits":[{"find":"<exact snippet copied from the current file>","replace":"<replacement>"}],"rationale":"<why>"}]}.',
            'For NEW files only, you may use {"op":"write","path":...,"content":"<full content>","rationale":...}.',
            'Rules: every find must be copied EXACTLY from the provided current content and must match exactly once; make the smallest edit that solves the issue; NEVER rewrite a whole existing file; never touch paths outside the scope.',
            `Issue: ${c.issue}`,
            `Allowed path prefixes (scope): ${c.scope.join(', ')}`,
            `Acceptance: vitest target ${c.acceptance.target} must pass.`,
            files.length ? `Current in-scope files:\n${files.join('\n')}` : 'No existing in-scope files (every op will be a new file).'
        ].join('\n');
        // [P1] Env-driven planner routing, nothing hardcoded.
        const env = process.env;
        const options: CompletionOptions = {
            temperature: Number(env.SELFDEV_PLANNER_TEMPERATURE ?? 0.2),
            maxTokens: Number(env.SELFDEV_PLANNER_MAX_TOKENS ?? 8192),
        };
        if (env.SELFDEV_PLANNER_PROVIDER) options.preferredProvider = env.SELFDEV_PLANNER_PROVIDER;
        if (env.SELFDEV_PLANNER_MODEL) (options as { model?: string }).model = env.SELFDEV_PLANNER_MODEL;

        // One repair retry: LLMs occasionally wrap JSON in prose or fences.
        let lastErr: Error | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const prompt = attempt === 1
                ? base
                : `${base}\n\nYour previous answer was invalid (${lastErr!.message}). Return STRICT JSON only, no prose, no code fences.`;
            const out: unknown = await llmGateway.complete(prompt, options);
            const text: string = typeof out === 'string' ? out : ((out as { text?: string; content?: string })?.text ?? (out as { content?: string })?.content ?? '');
            try {
                const ops = SelfDevCycleService.parsePlanJson(text);
                this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'PLANNER_OK', attempt, provider: options.preferredProvider ?? 'default', model: env.SELFDEV_PLANNER_MODEL ?? 'default' });
                return ops;
            } catch (err) {
                lastErr = err as Error;
                this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'PLANNER_RETRY', attempt, detail: lastErr.message });
            }
        }
        throw lastErr ?? new Error('planner failed without detail');
    }

    /**
     * Extract the first balanced JSON object from planner output. Tolerates
     * code fences and surrounding prose; never throws on malformed input
     * without a clear message. Exported for regression tests.
     */
    public static parsePlanJson(raw: string): CycleOp[] {
        const text = raw.replace(/```(?:json)?/gi, '');
        const start = text.indexOf('{');
        if (start < 0) throw new Error('planner returned no JSON object');
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const parsed = JSON.parse(text.slice(start, i + 1));
                    if (!parsed || !Array.isArray(parsed.ops)) throw new Error('planner JSON missing ops array');
                    return parsed.ops as CycleOp[];
                }
            }
        }
        throw new Error('planner JSON object never closed');
    }

    public async execute(id: string): Promise<SelfDevCycle> {
        const c = this.get(id);
        if (c.state !== 'ATTEMPTED' || !c.patch) throw Object.assign(new Error(`execute requires ATTEMPTED (current: ${c.state})`), { statusCode: 409 });

        // Freshness sync (again): main may have moved between attempt and
        // execute. VERIFIED is impossible without current code: if the sync
        // is unavailable we still land the ops (auditable in the clone) but
        // skip every gate and the acceptance run with an honest reason.
        let stale = false;
        try {
            await selfCodeService.syncWithUpstream();
        } catch (err) {
            stale = true;
            this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'ERROR', detail: `worktree sync unavailable at execute: ${(err as Error).message}` });
        }

        // GATE 1+2 (pre-write, pure): scope containment + anti-gut shrink check.
        // VERIFIED must mean correct: a patch that escapes its declared scope or
        // deletes more than half of a target file is FAILED before it touches disk.
        const originals = new Map<string, string | null>();
        for (const o of c.patch.ops) {
            try {
                const r = await selfCodeService.readFile(o.path);
                originals.set(o.path, r?.content ?? null);
            } catch { originals.set(o.path, null); }
        }
        const readOriginal = (p: string): string | null => originals.get(p) ?? null;
        // The gates judge exactly what would land on disk: for edit ops that
        // is the current content with the anchors applied, computed in memory.
        const effective: GateOp[] = [];
        for (const o of c.patch.ops) {
            if (o.op === 'edit') {
                const original = originals.get(o.path);
                if (original == null) {
                    this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'GATE_BLOCKED', detail: `edit target missing in clone: ${o.path}` });
                    this.transition(c, 'FAILED', `edit target missing in clone: ${o.path}`);
                    return c;
                }
                try {
                    effective.push({ path: o.path, content: applyCycleEdits(original, o.edits!) });
                } catch (err) {
                    this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'GATE_BLOCKED', detail: `edit anchor failed for ${o.path}: ${(err as Error).message}` });
                    this.transition(c, 'FAILED', `edit anchor failed for ${o.path}: ${(err as Error).message}`);
                    return c;
                }
            } else {
                effective.push({ path: o.path, content: o.content! });
            }
        }
        const preGate = checkScope(effective, c.scope) || checkShrink(effective, readOriginal);
        if (preGate) {
            this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'GATE_BLOCKED', detail: `${preGate.gate}: ${preGate.detail}` });
            this.transition(c, 'FAILED', `diff sanity gate (${preGate.gate}): ${preGate.detail}`);
            return c;
        }

        // Apply ops inside the isolated clone (F2, journaled there too).
        for (const o of c.patch.ops) {
            try {
                if (o.op === 'edit') {
                    await selfCodeService.applyEdits(o.path, o.edits!, `selfdev cycle ${c.id}: ${o.rationale}`);
                } else {
                    await selfCodeService.writeFile(o.path, o.content!, `selfdev cycle ${c.id}: ${o.rationale}`);
                }
            } catch (err) {
                this.transition(c, 'FAILED', `write failed for ${o.path}: ${(err as Error).message}`);
                return c;
            }
        }
        c.diff = (await selfCodeService.diff()).diff;
        this.transition(c, 'EXECUTED', `applied ${c.patch.ops.length} ops in selfwork clone`);

        if (stale) {
            c.lastError = 'verification unavailable (worktree sync): gates skipped, cycle cannot be VERIFIED against stale code';
            c.updatedAt = new Date().toISOString();
            this.journal({ ts: c.updatedAt, cycleId: c.id, event: 'ERROR', detail: c.lastError });
            this.save();
            return c;
        }

        // GATE 3 (post-write): full typecheck in the clone. A patch that does
        // not compile can never be VERIFIED, whatever the acceptance test says.
        try {
            const t = await selfCodeService.runTypecheck();
            c.runs.push({ kind: 'tsc', target: 'tsc --noEmit', code: t.code, pass: t.code === 0, outputTail: t.output.slice(-2000), at: new Date().toISOString() });
            if (t.code !== 0) {
                this.transition(c, 'FAILED', `typecheck gate failed (exit ${t.code})`);
                return c;
            }
        } catch (err) {
            c.lastError = `verification unavailable (typecheck gate): ${(err as Error).message}`;
            c.updatedAt = new Date().toISOString();
            this.journal({ ts: c.updatedAt, cycleId: c.id, event: 'ERROR', detail: c.lastError });
            this.save();
            return c;
        }

        // GATE 4 (post-write): every touched route module must import cleanly.
        for (const o of c.patch.ops) {
            if (!/^server\/routes\//.test(o.path)) continue;
            try {
                const r = await selfCodeService.runRouteSmoke(o.path);
                c.runs.push({ kind: 'route-smoke', target: o.path, code: r.code, pass: r.code === 0, outputTail: r.output.slice(-2000), at: new Date().toISOString() });
                if (r.code !== 0) {
                    this.transition(c, 'FAILED', `route smoke gate failed for ${o.path} (exit ${r.code})`);
                    return c;
                }
            } catch (err) {
                c.lastError = `verification unavailable (route smoke gate): ${(err as Error).message}`;
                c.updatedAt = new Date().toISOString();
                this.journal({ ts: c.updatedAt, cycleId: c.id, event: 'ERROR', detail: c.lastError });
                this.save();
                return c;
            }
        }

        // Real verification: acceptance test twice, both must pass.
        for (let i = 1; i <= 2; i++) {
            try {
                const r = await selfCodeService.runTest(c.acceptance.target);
                const run: CycleRun = { kind: 'vitest', target: c.acceptance.target, code: r.code, pass: r.code === 0, outputTail: r.output.slice(-2000), at: new Date().toISOString() };
                c.runs.push(run);
                this.journal({ ts: run.at, cycleId: c.id, event: 'VERIFY_RUN', pass: run.pass, code: run.code, run: i });
                if (!run.pass) {
                    this.transition(c, 'FAILED', `acceptance failed (run ${i}, exit ${r.code})`);
                    return c;
                }
            } catch (err) {
                // Infrastructure unavailable (e.g. node_modules missing in the
                // clone) is NOT a failing patch: stay EXECUTED with the reason.
                c.lastError = `verification unavailable: ${(err as Error).message}`;
                c.updatedAt = new Date().toISOString();
                this.journal({ ts: c.updatedAt, cycleId: c.id, event: 'ERROR', detail: c.lastError });
                this.save();
                return c;
            }
        }
        delete c.lastError;
        this.transition(c, 'VERIFIED', 'acceptance passed twice (flake guard); CI on the PR remains the full gate');
        return c;
    }

    public requestPR(id: string, approvedBy?: string): SelfDevCycle {
        const c = this.get(id);
        const by = (approvedBy ?? '').trim();
        if (!by) throw Object.assign(new Error('approvedBy is required: PR creation is operator-approved'), { statusCode: 400 });
        if (c.state !== 'VERIFIED') throw Object.assign(new Error(`pr requires VERIFIED (current: ${c.state})`), { statusCode: 409 });
        const at = new Date().toISOString();
        c.pr = { approvedBy: by, requestedAt: at };
        const branch = `selfdev/cycle-${c.id}`;
        const handoff = {
            cycleId: c.id, branch,
            title: `selfdev(${c.id.slice(0, 8)}): ${c.issue.slice(0, 70)}`,
            body: [
                `## Self-dev cycle ${c.id}`, '',
                `Issue: ${c.issue}`, '',
                `Patch source: ${c.patch?.source}. Acceptance: vitest ${c.acceptance.target} passed twice in the isolated clone.`,
                `Approved for PR creation by operator: ${by} at ${at}.`, '',
                'Paths:', ...(c.patch?.ops.map(o => `- ${o.path}`) ?? [])
            ].join('\n'),
            paths: c.patch?.ops.map(o => o.path) ?? [],
            requestedBy: by, requestedAt: at
        };
        const tmp = path.join(this.requestsDir(), `.${c.id}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(handoff, null, 2), 'utf-8');
        fs.renameSync(tmp, path.join(this.requestsDir(), `${c.id}.json`));
        this.journal({ ts: at, cycleId: c.id, event: 'PR_REQUESTED', approvedBy: by, branch });
        this.transition(c, 'PR_SUBMITTED', `approved by ${by}; handoff written for root publisher (push-via-root, decision (b))`);
        return c;
    }

    /** Opportunistically pick up the root publisher's result. */
    public refresh(id: string): SelfDevCycle {
        const c = this.get(id);
        if (c.state !== 'PR_SUBMITTED') return c;
        const rp = path.join(this.resultsDir(), `${c.id}.json`);
        if (!fs.existsSync(rp)) return c;
        try {
            const res = JSON.parse(fs.readFileSync(rp, 'utf8'));
            if (res.ok && res.prUrl) {
                c.pr = { ...c.pr!, url: res.prUrl, number: res.number };
                this.transition(c, 'PR_OPEN', `PR created by root publisher: ${res.prUrl}`);
            } else {
                c.lastError = `publisher error: ${res.error ?? 'unknown'}`;
                c.updatedAt = new Date().toISOString();
                this.journal({ ts: c.updatedAt, cycleId: c.id, event: 'ERROR', detail: c.lastError });
                this.save();
            }
        } catch (err) {
            this.journal({ ts: new Date().toISOString(), cycleId: c.id, event: 'ERROR', detail: `unreadable publisher result: ${(err as Error).message}` });
        }
        return c;
    }

    /**
     * [P1] Pull the real PR outcome from GitHub (merged / closed-unmerged /
     * still open) and persist it. Outcome truth comes from GitHub, never
     * from the agent's own claim (DGM reward-hacking lesson).
     */
    public async syncOutcome(id: string): Promise<SelfDevCycle> {
        const c = this.get(id);
        if (c.state !== 'PR_OPEN' || !c.pr?.number) {
            throw Object.assign(new Error(`sync-outcome requires PR_OPEN with a PR number (current: ${c.state})`), { statusCode: 409 });
        }
        const env = process.env;
        const owner = env.GITHUB_REPO_OWNER, repo = env.GITHUB_REPO_NAME, token = env.GITHUB_TOKEN;
        if (!owner || !repo || !token) {
            throw Object.assign(new Error('GITHUB_REPO_OWNER / GITHUB_REPO_NAME / GITHUB_TOKEN not configured'), { statusCode: 503 });
        }
        const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${c.pr.number}`, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'silhouette-selfdev', Accept: 'application/vnd.github+json' }
        });
        if (!resp.ok) throw Object.assign(new Error(`GitHub API responded ${resp.status}`), { statusCode: 502 });
        const pr = await resp.json() as { merged_at?: string | null; closed_at?: string | null; state?: string };
        const at = new Date().toISOString();
        const state = pr.merged_at ? 'merged' : (pr.state === 'closed' ? 'closed-unmerged' : 'open');
        c.outcome = { state, mergedAt: pr.merged_at ?? undefined, closedAt: pr.closed_at ?? undefined, syncedAt: at };
        c.updatedAt = at;
        this.journal({ ts: at, cycleId: c.id, event: 'OUTCOME_SYNCED', outcome: state, pr: c.pr.number });
        this.save();
        return c;
    }

    /**
     * [P1] Outcome metrics across every persisted cycle (Copilot-style:
     * PRs created vs merged, time plan->PR). Eternal memory: computed from
     * the persisted store, nothing is ever deleted.
     */
    public metrics() {
        const cycles = this.store.cycles;
        const byState: Record<string, number> = {};
        const bySource: Record<string, number> = {};
        let merged = 0, closedUnmerged = 0;
        const planToPrMs: number[] = [];
        for (const c of cycles) {
            byState[c.state] = (byState[c.state] ?? 0) + 1;
            if (c.patch?.source) bySource[c.patch.source] = (bySource[c.patch.source] ?? 0) + 1;
            if (c.outcome?.state === 'merged') merged++;
            if (c.outcome?.state === 'closed-unmerged') closedUnmerged++;
            if (c.pr?.requestedAt) planToPrMs.push(Date.parse(c.pr.requestedAt) - Date.parse(c.createdAt));
        }
        planToPrMs.sort((a, b) => a - b);
        const decided = merged + closedUnmerged;
        return {
            total: cycles.length,
            byState,
            bySource,
            verifyFailures: byState['FAILED'] ?? 0,
            prs: {
                created: byState['PR_OPEN'] ?? 0,
                merged,
                closedUnmerged,
                mergeRate: decided > 0 ? merged / decided : null,
            },
            medianMsPlanToPR: planToPrMs.length ? planToPrMs[Math.floor(planToPrMs.length / 2)] : null,
            generatedAt: new Date().toISOString(),
        };
    }

    public abandon(id: string, reason?: string): SelfDevCycle {
        const c = this.get(id);
        if (!ACTIVE_STATES.includes(c.state)) throw Object.assign(new Error(`cannot abandon from ${c.state}`), { statusCode: 409 });
        this.transition(c, 'ABANDONED', reason ?? 'abandoned by operator');
        return c;
    }

    public journalEntries(cycleId: string, limit = 100): unknown[] {
        const p = this.journalPath();
        if (!fs.existsSync(p)) return [];
        return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(e => e && e.cycleId === cycleId)
            .slice(-Math.max(1, Math.min(limit, 500)));
    }
}

export const selfDevCycleService = new SelfDevCycleService();
