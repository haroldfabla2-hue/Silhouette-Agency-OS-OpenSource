/**
 * [PR-4c] Agent lifecycle fixes — regression anchors for the prod incident
 * of 2026-10-16 (717 zombie resets, 346% CPU, 212 immortal phantom agents,
 * 30+ same-signature remediation loops, orphan "running" ledger rows).
 *
 * Source-audit pattern: anchor on stable code signatures within bounded
 * windows, never on prose that other PRs legitimately rewrite.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function windowAround(src: string, anchor: string, span = 3000): string {
    const i = src.indexOf(anchor);
    if (i === -1) throw new Error(`anchor not found: ${anchor}`);
    return src.slice(Math.max(0, i - span), i + span);
}

describe('PR-4c: purge is terminal (no resurrection)', () => {
    const src = read('services/orchestrator.ts');

    it('purgeAgent quarantines the on-disk directory before roster/DB removal', () => {
        const w = windowAround(src, 'public async purgeAgent');
        expect(w).toContain('agents_quarantine');
        expect(w).toContain('renameSync');
        // quarantine happens before the DB row delete
        expect(w.indexOf('agents_quarantine')).toBeLessThan(w.indexOf('deleteAgent'));
    });

    it('orchestrator exposes hydration check and terminal FAILED state', () => {
        expect(src).toContain('public isAgentHydrated(agentId: string): boolean');
        expect(src).toContain('public async markAgentFailed(agentId: string, reason: string)');
        const w = windowAround(src, 'markAgentFailed');
        expect(w).toContain('AgentStatus.OFFLINE');
        expect(w).toContain('agent.enabled = false');
    });
});

describe('PR-4c: zombie scan only sees hydrated working agents', () => {
    it('filter requires hydration and active work status', () => {
        const src = read('services/introspectionEngine.ts');
        const w = windowAround(src, 'const zombies = agents.filter');
        expect(w).toContain('orchestrator.isAgentHydrated(a.id)');
        expect(w).toContain("a.status === 'WORKING' || a.status === 'THINKING'");
    });
});

describe('PR-4c: remediation mobilization circuit breaker', () => {
    const src = read('services/remediationService.ts');

    it('breaker constants and throttle exist', () => {
        expect(src).toContain('MAX_MOBILIZATIONS_PER_HOUR = 3');
        expect(src).toContain('MOBILIZATION_WINDOW_MS');
        expect(src).toContain('MOBILIZATION_BACKOFF_BASE_MS');
        expect(src).toContain('public mobilizationThrottle(signature: string');
    });

    it('mobilizeSquad checks the breaker before doing any work', () => {
        const w = windowAround(src, 'public async mobilizeSquad');
        const inquisitors = w.indexOf('Wake up The Inquisitors');
        expect(w.indexOf('mobilizationSignature')).toBeLessThan(inquisitors);
        expect(w.indexOf('CIRCUIT OPEN')).toBeLessThan(inquisitors);
        expect(w).toContain('markAgentFailed');
        expect(w).toContain("source: 'SYSTEM_ALERT'");
    });
});

describe('PR-4c: memory tier coercion at the boundary', () => {
    it('invalid tier is coerced before the gatekeeper', () => {
        const src = read('services/continuumMemory.ts');
        const store = windowAround(src, 'public async store', 4000);
        expect(store).toContain('coerced to WORKING');
        expect(store.indexOf('coerced to WORKING')).toBeLessThan(store.indexOf('Anti-Recursion Guard 1'));
    });
});

describe('PR-4c: spurious provider tool deltas are tolerated', () => {
    // Updated by PR-E (2026-10-16): named native tool-call deltas are no longer
    // thrown away — they are accumulated and re-emitted as [EXECUTE:] markers
    // that the tool pipeline executes honestly (role gates + fs jail apply).
    // The throw killed a healthy fallback leg (Ollama Cloud) mid-chat.
    it('empty tool-call delta warns and skips; named ones become [EXECUTE:] markers', () => {
        const src = read('services/llm/streamAdapters.ts');
        const w = windowAround(src, "event.type === 'tool'", 2000);
        expect(w).toContain('spurious empty tool-call delta');
        expect(w).toContain('pendingToolCalls');
        expect(src).toContain('[EXECUTE: ${call.name.trim()} ${args}]');
        expect(src).not.toContain('unexpected tool call delta');
    });
});

describe('PR-4c: task ledger never leaves orphan rows', () => {
    it('closeOpenTasks exists and planExecutor calls it', () => {
        const ledger = read('services/execution/taskLedger.ts');
        expect(ledger).toContain('export function closeOpenTasks');
        expect(ledger).toContain("aborted:");
        const exec = read('services/planExecutor.ts');
        expect(exec).toContain('closeOpenTasks(plan.id, new Set(results.keys())');
    });
});
