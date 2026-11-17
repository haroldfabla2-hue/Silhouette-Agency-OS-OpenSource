/**
 * SQLite close failure-ownership — REAL better-sqlite3 library states, no mocks.
 *
 * Verifies the close contract fixed in this unit:
 * - close() PROPAGATES a genuine driver failure (live statement iterator)
 *   instead of swallowing it, and the failed handle stays owned and open so a
 *   later close can retry once the work settles.
 * - A retry after the iterator is released succeeds; a double close is the
 *   driver's native no-op, not a swallowed error.
 * - SqliteAdapter.close() attempts EVERY owned handle even when another
 *   handle's close fails, aggregates the failures (one per genuinely failing
 *   handle), and rethrows only after all attempts.
 *
 * Every failure condition is a real library state of the actual installed
 * better-sqlite3 (its exact version is receipted). A successful close is a
 * 'JS driver close completed' receipt only - the native sqlite3_close status
 * is checked only by a C/C++ assert (release builds may compile it out), so
 * no persistence or durability claim is made or tested here.
 *
 * Isolation and cleanup: each adapter case runs on a FRESH module registry
 * (vi.resetModules), so its sqliteService singleton is case-owned; vitest
 * retry:1 always starts from a clean registry. ALL acquisitions (imports,
 * constructions, temp dirs) happen inside the outer try with nullable
 * tracked references; the finally attempts each cleanup INDEPENDENTLY
 * (iterators, both DB handles, temp dir), collects secondary errors, and
 * never replaces a propagating primary failure - cleanup failures fail the
 * test only when the primary path succeeded. Partial handles never returned
 * by a throwing production constructor remain the explicitly deferred
 * production gap; this fixture does not pretend to repair it.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { SqliteService, sqliteService as topLevelSingleton } from '../../services/sqliteService';

// Actual installed driver version: receipted, not asserted, so the evidence
// records exactly which library produced the observed behavior.
const DRIVER_VERSION: string = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'package.json'), 'utf8')
).version;

const BUSY_MESSAGE = 'busy executing a query';

function makeProbeTable(db: Database.Database): void {
    db.exec('CREATE TABLE IF NOT EXISTS close_ownership_probe (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO close_ownership_probe (v) VALUES (?)').run('a');
    db.prepare('INSERT INTO close_ownership_probe (v) VALUES (?)').run('b');
}

/** Real live iterator over a deterministic multi-row probe. Ownership is
 * registered with the caller BEFORE next()/assert. A failed next or assert
 * leaves the iterator REGISTERED and rethrows the original failure: the
 * caller's outer finally (returnAllIterators, independent per-resource
 * attempts) owns its cleanup, so the primary error is never replaced by a
 * helper-side return failure. */
function liveIterator(db: Database.Database, owned: IterableIterator<unknown>[]): void {
    makeProbeTable(db);
    const iterator = db.prepare('SELECT v FROM close_ownership_probe ORDER BY id').iterate();
    owned.push(iterator);
    expect(iterator.next().done, 'probe must be multi-row so the iterator is genuinely live').toBe(false);
}

/** Returns every owned iterator; an iterator leaves the registry only after
 * its OWN successful return. Cleanup passes `errors` to collect secondary
 * failures instead of throwing. */
function returnAllIterators(owned: IterableIterator<unknown>[], errors?: unknown[]): void {
    for (let i = owned.length - 1; i >= 0; i--) {
        try {
            owned[i].return?.();
            owned.splice(i, 1);
        } catch (error) {
            if (errors) errors.push(error);
            else throw error;
        }
    }
}

describe('SQLite close failure-ownership (real library states)', () => {
    it('service close propagates a genuine busy failure; handle stays owned; retry and double close behave per driver contract', () => {
        let svc: SqliteService | null = null;
        const ownedIterators: IterableIterator<unknown>[] = [];
        const cleanupErrors: unknown[] = [];
        // Measured receipts, captured at observation time (never hardcoded).
        const receipt: Record<string, unknown> = { installedDriver: DRIVER_VERSION, persistenceClaimed: false };
        try {
            svc = new SqliteService(); // real per-worker temp DB (tests/setup/sqlite-per-worker.ts)
            const db = svc.db;
            expect(db.open).toBe(true);
            liveIterator(db, ownedIterators);

            let firstThrew: unknown = null;
            try {
                svc.close();
            } catch (error) {
                firstThrew = error;
            }
            receipt.firstCloseThrew = firstThrew === null ? null : String((firstThrew as Error).message);
            receipt.openAfterFailure = db.open; // measured NOW, at the observation
            expect(firstThrew).toBeInstanceOf(TypeError);
            expect(String((firstThrew as Error).message)).toContain(BUSY_MESSAGE);
            expect(db.open, 'failed close: handle retained, still open').toBe(true);

            returnAllIterators(ownedIterators); // release the real iterator so the retry can succeed
            db.exec('DROP TABLE IF EXISTS close_ownership_probe');

            svc.close(); // retry after settle: succeeds
            receipt.openAfterRetry = db.open;
            expect(db.open).toBe(false);

            let doubleThrew: unknown = null;
            try {
                svc.close(); // double close: native no-op (JS_close checks db->open)
            } catch (error) {
                doubleThrew = error;
            }
            receipt.doubleCloseThrew = doubleThrew !== null;
            expect(doubleThrew).toBeNull();
            expect(db.open).toBe(false);
        } finally {
            // Independent per-resource attempts: one failure never skips the rest.
            returnAllIterators(ownedIterators, cleanupErrors);
            try {
                if (svc && svc.db.open) svc.close();
            } catch (error) { cleanupErrors.push(error); }
            try {
                // The top-level import instantiated the shared singleton at
                // module evaluation: close that acquired handle too (driver
                // no-op if already closed; adapter cases use fresh registries
                // and never touch this one).
                if (topLevelSingleton.db.open) topLevelSingleton.close();
            } catch (error) { cleanupErrors.push(error); }
            if (cleanupErrors.length > 0) console.error('[sqlite-close-ownership cleanup errors]', cleanupErrors);
        }
        // Reached only when no primary failure is propagating: cleanup
        // failures are then reported as their own failure, never masked.
        if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'sqlite-close-ownership cleanup failed');
        console.log('[sqlite-close-ownership receipt]', JSON.stringify(receipt));
    });

    // Core-only, identity-only and both-failure cases. Each uses real live
    // iterators; the aggregate error count must equal the number of genuinely
    // failing handles, and every error must be the real busy failure.
    for (const mode of ['core-only', 'identity-only', 'both'] as const) {
        it(`adapter close: ${mode} failure - all handles attempted, failures aggregated after attempts, retry and double close clean`, async () => {
            const failCore = mode !== 'identity-only';
            const failIdentity = mode !== 'core-only';
            const expectedFailures = (failCore ? 1 : 0) + (failIdentity ? 1 : 0);

            // Nullable tracked references: EVERY acquisition happens inside
            // the outer try, so the finally can release whatever was acquired.
            let caseCore: typeof import('../../services/sqliteService').sqliteService | null = null;
            let adapter: import('../../services/database/sqliteAdapter').SqliteAdapter | null = null;
            let identity: Database.Database | null = null;
            let identityDir: string | null = null;
            const ownedIterators: IterableIterator<unknown>[] = [];
            const cleanupErrors: unknown[] = [];
            const receipt: Record<string, unknown> = { installedDriver: DRIVER_VERSION, case: mode, persistenceClaimed: false };
            try {
                vi.resetModules(); // case-owned singleton: fresh module registry
                ({ sqliteService: caseCore } = await import('../../services/sqliteService'));
                const adapterModule = await import('../../services/database/sqliteAdapter'); // same fresh registry as caseCore
                adapter = new adapterModule.SqliteAdapter();
                identityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sil-identity-close-'));
                identity = new Database(path.join(identityDir, 'identity.sqlite')); // real second owned handle
                (adapter as any).identityDb = identity;
                if (failCore) liveIterator(caseCore.db, ownedIterators);
                if (failIdentity) liveIterator(identity, ownedIterators);

                let threw: unknown = null;
                try {
                    await adapter.close();
                } catch (error) {
                    threw = error;
                }
                receipt.firstCloseThrew = threw === null ? null : String((threw as Error).message);
                receipt.aggregateCount = threw instanceof AggregateError ? threw.errors.length : null;
                receipt.coreOpenAfterFailure = caseCore.db.open;   // measured
                receipt.identityOpenAfterFailure = identity.open;  // measured
                receipt.identityHandleRetained = (adapter as any).identityDb === identity;

                expect(threw).toBeInstanceOf(AggregateError);
                expect(String((threw as AggregateError).message)).toContain('SQLITE_ADAPTER_CLOSE_FAILED');
                expect((threw as AggregateError).errors.length, 'one aggregated error per genuinely failing handle').toBe(expectedFailures);
                for (const failure of (threw as AggregateError).errors) {
                    expect(String((failure as Error).message)).toContain(BUSY_MESSAGE);
                }
                // Every owned handle was ATTEMPTED despite the other failure:
                expect(caseCore.db.open, 'core: retained open on genuine failure, closed when it did not fail').toBe(failCore);
                expect(identity.open, 'identity: retained open on genuine failure, closed when it did not fail').toBe(failIdentity);
                expect((adapter as any).identityDb, 'failed identity handle retained, never nulled').toBe(identity);

                returnAllIterators(ownedIterators); // release, then retry
                await adapter.close();
                receipt.coreOpenAfterRetry = caseCore.db.open;
                receipt.identityOpenAfterRetry = identity.open;
                expect(caseCore.db.open).toBe(false);
                expect(identity.open).toBe(false);

                let doubleThrew: unknown = null;
                try {
                    await adapter.close(); // double close: driver no-op for both handles
                } catch (error) {
                    doubleThrew = error;
                }
                receipt.doubleCloseThrew = doubleThrew !== null;
                expect(doubleThrew).toBeNull();
                expect(caseCore.db.open).toBe(false);
                expect(identity.open).toBe(false);
            } finally {
                // Independent per-resource attempts, secondary errors collected.
                returnAllIterators(ownedIterators, cleanupErrors);
                try {
                    if (caseCore && caseCore.db.open) caseCore.close();
                } catch (error) { cleanupErrors.push(error); }
                try {
                    if (identity && identity.open) identity.close();
                } catch (error) { cleanupErrors.push(error); }
                try {
                    if (identityDir) fs.rmSync(identityDir, { recursive: true, force: true });
                } catch (error) { cleanupErrors.push(error); }
                if (cleanupErrors.length > 0) console.error(`[sqlite-adapter-close cleanup errors ${mode}]`, cleanupErrors);
            }
            if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `sqlite-adapter-close cleanup failed (${mode})`);
            console.log('[sqlite-adapter-close receipt]', JSON.stringify(receipt));
        });
    }
});
