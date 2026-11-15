import '../setup/require-cloud-only';
import { captureStartedMessageProducer, observeMessageProducer } from '../setup/observe-message-producer';
/**
 * AUTOMATED TEST SUITE: Cognitive-state engine (phi composite index)
 * Verifies the phi score is a transparent, explainable weighted composite —
 * not a magic number — and that weights sum to 1.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { captureStartedBootstrap, observePublicBootstrap, type BootstrapCapture } from '../setup/observe-public-bootstrap';
let bootstrapCapture: BootstrapCapture | undefined;
const importFailures: unknown[] = [];
async function actualConsciousness() {
    try { return await import('../../services/consciousnessEngine'); }
    catch (error) { importFailures.push(error); throw error; }
    finally {
        bootstrapCapture ??= captureStartedBootstrap();
    }
}

let identityOwner: typeof import('../../services/consciousnessEngine').consciousness | undefined;
afterAll(async () => {
    // Runs even if a metric assertion failed. Rejection fails the hook visibly.
    const failures: unknown[] = [...importFailures];
    let identitySettled = false;
    try {
        if (!identityOwner) throw new Error('Metrics identity owner not observed');
        await identityOwner.ready();
        identitySettled = true;
    } catch (error) { failures.push(error); }
    let applicabilityObserved = false;
    try {
        await observePublicBootstrap(bootstrapCapture, async ({ retainedOwnersObservedWithoutFailure }) => {
            applicabilityObserved = true;
            // Snapshot only, AFTER identity/initial concept+goals/effects, BEFORE Redis disconnect.
            const incidentalProducer = captureStartedMessageProducer();
            if (incidentalProducer) {
                try { await observeMessageProducer(incidentalProducer); }
                finally {
                    // Its admitted roots could create effects after the bootstrap cut above.
                    // Even an idle join does not establish a reviewed second effect boundary.
                    console.log('METRICS_GETTER_MESSAGE_PRODUCER_APPLICABILITY: INCOMPLETE_RETAINED_EFFECTS_AFTER_INCIDENTAL_JOIN_UNVERIFIED');
                    failures.push(new Error('Retained effects after incidental message join unverified'));
                }
                return;
            }
            if (importFailures.length || !identitySettled || !retainedOwnersObservedWithoutFailure) {
                console.log('METRICS_GETTER_MESSAGE_PRODUCER_APPLICABILITY: INCOMPLETE_REACH_UNKNOWN');
                throw new Error('Metrics getter source graph applicability unresolved');
            }
            // Only this fixed getter-only entry has the reviewed no-required-producer contract.
            // tick/large ingestion/corpus/entry drift requires a new source-graph review.
            console.log('METRICS_GETTER_MESSAGE_PRODUCER_APPLICABILITY:', {
                entry: 'CONSCIOUSNESS_IMPORT_GET_PHI_BREAKDOWN_ONLY',
                outcome: 'NOT_APPLICABLE_SOURCE_GRAPH',
                observation: 'NOT_OBSERVED_AFTER_RETAINED_STARTUP_EFFECTS',
                scope: 'no required message-body owner for this reviewed entry; not absence/global drain/Redis safety proof',
            });
        });
    } catch (error) { failures.push(error); }
    if (!applicabilityObserved) failures.push(new Error('Metrics applicability observation seam not reached'));
    if (failures.length) throw new AggregateError(failures, 'Identity/import/public bootstrap ownership failed');
});

describe('Cognitive-state engine', () => {
    it('exposes a transparent phi breakdown with normalized factors', async () => {
        const { consciousness } = await actualConsciousness();
        identityOwner = consciousness;
        const breakdown = consciousness.getPhiBreakdown();

        expect(breakdown).toHaveProperty('memoryFactor');
        expect(breakdown).toHaveProperty('throughputFactor');
        expect(breakdown).toHaveProperty('emergenceFactor');
        expect(breakdown).toHaveProperty('networkFactor');
        expect(breakdown).toHaveProperty('contributions');
        expect(breakdown).toHaveProperty('phiScore');
    });

    it('uses weights that sum to 1 (well-formed composite)', async () => {
        const { consciousness } = await actualConsciousness();
        identityOwner = consciousness;
        const { weights } = consciousness.getPhiBreakdown();
        const sum = weights.memory + weights.throughput + weights.emergence + weights.network;
        expect(sum).toBeCloseTo(1.0, 5);
    });

    it('keeps every normalized factor within [0,1]', async () => {
        const { consciousness } = await actualConsciousness();
        identityOwner = consciousness;
        const b = consciousness.getPhiBreakdown();
        for (const f of [b.memoryFactor, b.throughputFactor, b.emergenceFactor, b.networkFactor]) {
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThanOrEqual(1);
        }
    });
});
