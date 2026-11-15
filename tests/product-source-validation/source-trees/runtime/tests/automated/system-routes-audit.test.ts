import '../setup/require-cloud-only';
import { captureStartedMessageProducer, observeMessageProducer, type MessageProducerCapture } from '../setup/observe-message-producer';
let messageProducerCapture: MessageProducerCapture;
/**
 * Regression tests for the dashboard audit (batch 1):
 * 1. /auto-evolution routes must be registered at import time.
 *    They were accidentally nested inside the /health handler, so they
 *    only existed after something called /health (404 after every boot).
 * 2. GET /auto-evolution must never return characters of the real token
 *    (constant mask only; the POST handler treats the mask as "keep existing").
 */
import { describe, it, expect, afterAll } from 'vitest';
import { captureStartedBootstrap, observePublicBootstrap, type BootstrapCapture } from '../setup/observe-public-bootstrap';
import { captureStartedResourceArbiter, observeResourceArbiter, type ArbiterCapture } from '../setup/observe-resource-arbiter';
import { captureStartedNarrative, observeNarrative, type NarrativeCapture } from '../setup/observe-narrative';
let narrativeCapture: NarrativeCapture;
let arbiterCapture: ArbiterCapture;
let controllerOwner: typeof import('../../server/controllers/systemController').systemController | undefined;
let bootstrapCapture: BootstrapCapture | undefined;
const importFailures: unknown[] = [];
async function actualRoutes() {
    try {
        const routes = await import('../../server/routes/v1/system.routes');
        // Fulfillment proves its static systemController dependency evaluated.
        controllerOwner = (await import('../../server/controllers/systemController')).systemController;
        return routes;
    } catch (error) {
        importFailures.push(error);
        throw error;
    } finally {
        // A failed route import never forces a controller import here.
        messageProducerCapture ??= captureStartedMessageProducer();
        narrativeCapture ??= captureStartedNarrative();
        arbiterCapture ??= captureStartedResourceArbiter();
        bootstrapCapture ??= captureStartedBootstrap();
    }
}
afterAll(async () => {
    const failures: unknown[] = [...importFailures];
    try {
    if (controllerOwner) {
        // Read-only diagnostic of this retained real owner; no mock/clock/reset.
        const owner = controllerOwner;
        const snapshot = () => ({
            admissionOpen: Reflect.get(owner, 'isPolling'),
            timerPresent: Reflect.get(owner, 'telemetryPollTimer') !== undefined,
            refreshOwnerPresent: Reflect.get(owner, 'telemetryPollOwner') !== undefined,
            historicalFailurePresent: Reflect.get(owner, 'telemetryPollFailure') !== undefined
        });
        const before = snapshot();
        const stop = owner.stopBackgroundPolling();
        const afterAdmissionStop = snapshot();
        const sameStopOwner = stop === owner.stopBackgroundPolling();
        let stopOutcome = 'FULFILLED';
        try { await stop; } catch (error) { stopOutcome = 'REJECTED'; failures.push(error); }
        const afterSettlement = snapshot();
        console.log('ACTUAL_TELEMETRY_POLL_OWNER:', {
            before, afterAdmissionStop, afterSettlement, sameStopOwner, stopOutcome,
            scope: 'retained poll at settlement only; not future global admission or timed absence proof'
        });
        if (!sameStopOwner || afterAdmissionStop.admissionOpen !== false ||
            afterAdmissionStop.timerPresent || afterSettlement.admissionOpen !== false ||
            afterSettlement.timerPresent ||
            (afterSettlement.historicalFailurePresent && stopOutcome !== 'REJECTED')) {
            failures.push(new Error('Actual retained telemetry poll stop invariant failed'));
        }
    } else {
        console.log('ACTUAL_TELEMETRY_POLL_INCOMPLETE_NOT_OBSERVED: no retained controller');
    }
    } catch (error) { failures.push(error); }
    try { await observeMessageProducer(messageProducerCapture); } catch (error) { failures.push(error); }
    try { await observeNarrative(narrativeCapture); } catch (error) { failures.push(error); }
    try { await observeResourceArbiter(arbiterCapture); } catch (error) { failures.push(error); }
    try { await observePublicBootstrap(bootstrapCapture); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Route import/poll/bootstrap ownership failed');
});
import fs from 'fs';
import path from 'path';
import os from 'os';

const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

function findHandler(router: any, routePath: string, method: string) {
    const layer = router.stack.find((l: any) => l.route && l.route.path === routePath && l.route.methods[method]);
    return layer?.route.stack[0].handle;
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        body: null as any,
        json(o: any) { this.body = o; return this; },
        status(c: number) { this.statusCode = c; return this; }
    };
    return res;
}

describe('system.routes audit batch 1', () => {

    it('registers GET and POST /auto-evolution at import time (not nested in /health)', async () => {
        const mod = await actualRoutes();
        const router = mod.default as any;
        expect(findHandler(router, '/auto-evolution', 'get')).toBeTypeOf('function');
        expect(findHandler(router, '/auto-evolution', 'post')).toBeTypeOf('function');
        // /health must keep working and must NOT be the registration mechanism
        expect(findHandler(router, '/health', 'get')).toBeTypeOf('function');
    });

    it('GET /auto-evolution returns a constant mask and never token characters', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'));
        const SECRET = 'ghp_TESTSECRET1234567890wxyz';
        fs.writeFileSync(path.join(tmp, '.env.local'),
            `GITHUB_TOKEN=${SECRET}\nGITHUB_REPO_OWNER=some-owner\nGITHUB_REPO_NAME=some-repo\n`);
        const prevCwd = process.cwd();
        process.chdir(tmp);
        try {
            const mod = await actualRoutes();
            const handler = findHandler(mod.default as any, '/auto-evolution', 'get');
            const res = mockRes();
            await handler({} as any, res);
            expect(res.body.configured).toBe(true);
            expect(res.body.gitToken).toBe(MASK);
            const serialized = JSON.stringify(res.body);
            expect(serialized).not.toContain(SECRET);
            expect(serialized).not.toContain('wxyz'); // last4 must not leak
            expect(serialized).not.toContain('ghp_'); // prefix must not leak
            expect(res.body.gitOwner).toBe('some-owner');
            expect(res.body.gitRepo).toBe('some-repo');
        } finally {
            process.chdir(prevCwd);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('GET /auto-evolution reports configured:false when no .env.local exists', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-empty-'));
        const prevCwd = process.cwd();
        process.chdir(tmp);
        try {
            const mod = await actualRoutes();
            const handler = findHandler(mod.default as any, '/auto-evolution', 'get');
            const res = mockRes();
            await handler({} as any, res);
            expect(res.body.configured).toBe(false);
        } finally {
            process.chdir(prevCwd);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('POST /auto-evolution rejects missing fields with 400 (before any side effect)', async () => {
        const mod = await actualRoutes();
        const handler = findHandler(mod.default as any, '/auto-evolution', 'post');
        const res = mockRes();
        await handler({ body: { gitToken: 'x' } } as any, res);
        expect(res.statusCode).toBe(400);
    });
});
