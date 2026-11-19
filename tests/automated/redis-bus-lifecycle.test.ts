/**
 * RedisBusAdapter NORMAL lifecycle controls - supervised fresh process with
 * an OWNED scripted endpoint (ephemeral 127.0.0.1 port inside the child; no
 * host-default service is ever contacted). Covers concurrent connects,
 * partial sub-connect failure, subscribe failure, reconnect without
 * overwriting open handles, double disconnect, connect-after-disconnect,
 * and the connect-during-disconnect fence. The failed-close retention path
 * is NOT claimed as covered: with the pinned driver (@redis/client 5.10.0,
 * package-lock; observed sources cited in the child), disconnect() is a
 * synchronous destroy with no server round-trip, so this fixture cannot
 * produce a wire-induced close failure. The closeFailed/retained-pair route
 * remains an explicitly uncovered defensive path, not a disproven one.
 *
 * Runs the shared supervised-child contract (same shape as the reviewed
 * shutdown fixture): natural exit required, group probed, evidence complete.
 */
import { describe, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runChild, assertCleanChild, CLEANUP_BUDGET_MS } from '../real-process/supervised-child';

const CHILD_TIMEOUT_MS = 90_000; // bounded retry loops in the partial-failure phases

describe('redis bus adapter lifecycle (normal mode, owned endpoint)', () => {
    it('child: ownership, partial-failure cleanup, reconnect, fences, natural exit', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'redis-bus-lifecycle-'));
        let result: Awaited<ReturnType<typeof runChild>> | null = null;
        try {
            result = await runChild({
                script: resolve('tests/real-process/redis-bus-lifecycle-child.ts'),
                cwd: directory,
                env: {
                    PATH: process.env.PATH,
                    HOME: directory,
                    NODE_ENV: 'test',
                    SILHOUETTE_INFERENCE_MODE: 'cloud-only'
                },
                timeoutMs: CHILD_TIMEOUT_MS
            });
            assertCleanChild(result, 'redis-bus-lifecycle', 'REDIS_BUS_LIFECYCLE_CHILD_OK');
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
});
