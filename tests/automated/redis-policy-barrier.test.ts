/**
 * Redis acceptance policy barrier - supervised fresh-process proof.
 *
 * ACCEPTANCE: spawns tests/real-process/redis-policy-barrier-child.ts as a
 * real subprocess with SILHOUETTE_BOOT_MODE=acceptance AND both Redis upgrade
 * flags in its environment FROM BIRTH (fresh process, explicit mode; nothing
 * is concluded from the absence of a global BOOT_MODE in this job). The
 * child gets NO process.exit: natural termination is required and the
 * process group is probed afterwards (shared supervised-child contract, the
 * same shape as the reviewed shutdown fixture).
 *
 * NORMAL (in-process, no BOOT_MODE): the same getters stay honest outside
 * acceptance and the adapter constructs without connecting (construction
 * alone no longer touches the driver). No connect() is attempted here: the
 * connected lifecycle is covered by redis-bus-lifecycle.test.ts against an
 * OWNED endpoint, and the singleton fallback path by
 * redis-lazy-connect.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runChild, assertCleanChild, CLEANUP_BUDGET_MS } from '../real-process/supervised-child';

const CHILD_TIMEOUT_MS = 60_000;

describe('redis acceptance policy barrier', () => {
    it('acceptance child: barrier holds with flags present, daemon denied lock stays due, natural exit', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'redis-barrier-'));
        let result: Awaited<ReturnType<typeof runChild>> | null = null;
        try {
            result = await runChild({
                script: resolve('tests/real-process/redis-policy-barrier-child.ts'),
                cwd: directory,
                env: {
                    PATH: process.env.PATH,
                    HOME: directory,
                    NODE_ENV: 'test',
                    SILHOUETTE_BOOT_MODE: 'acceptance',
                    SILHOUETTE_INFERENCE_MODE: 'cloud-only',
                    USE_REDIS: 'true',
                    REDIS_URL: 'redis://127.0.0.1:1',
                    // Real-route requirements of the redisClient import chain
                    // (redisClient -> incidentRegistry -> sqliteService): the
                    // DB stays in this test's own mkdtemp, and the migration
                    // assets are the REVIEWED copy's real files, read-only,
                    // verified in-child by the product's own hash contract.
                    // Both keys are in ACCEPTANCE_ENV and survive the scrub.
                    SILHOUETTE_DB_PATH: join(directory, 'child.sqlite'),
                    SILHOUETTE_MIGRATIONS_DIR: resolve('db/migrations/sqlite')
                },
                timeoutMs: CHILD_TIMEOUT_MS
            });
            assertCleanChild(result, 'redis-policy-barrier', 'REDIS_POLICY_BARRIER_CHILD_OK');
        } finally {
            // Never delete a directory while processes may still hold it:
            // preserve it (and say where) when cleanup is not confirmed.
            const cleanupConfirmed = result !== null
                && !result.hadSurvivors && !result.survivorsAfterCleanup
                && result.childReaped && result.killError === null;
            if (cleanupConfirmed) {
                rmSync(directory, { recursive: true, force: true });
            } else {
                console.warn(`[fixture] cleanup NOT confirmed; preserving directory with evidence: ${directory}`);
            }
        }
    }, CHILD_TIMEOUT_MS + CLEANUP_BUDGET_MS + 30_000);

    it('normal mode: policy getters honest, adapter constructs without connecting', async () => {
        // No SILHOUETTE_BOOT_MODE in this worker: acceptanceBoot() is false.
        const { acceptanceBoot } = await import('../../services/security/bootMode');
        expect(acceptanceBoot()).toBe(false);

        const { redisClient } = await import('../../services/redisClient');
        expect(redisClient.isDisabledByPolicy()).toBe(false);
        // Before any connect attempt: not serving, no mock, no incident lie.
        expect(redisClient.isReallyConnected()).toBe(false);

        const { RedisBusAdapter } = await import('../../services/bus/RedisBusAdapter');
        const adapter = new RedisBusAdapter('redis://127.0.0.1:1');
        // Local listener registry only; never fires without a connection.
        let fired = false;
        await adapter.subscribe('BOOT_COMPLETE' as any, () => { fired = true; });
        expect(fired).toBe(false);
        // disconnect on never-connected clients is usable and quiet.
        await adapter.disconnect();
    });
});
