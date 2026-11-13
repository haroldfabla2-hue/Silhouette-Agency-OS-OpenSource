import '../setup/require-cloud-only';
import { captureStartedMessageProducer, observeMessageProducer, type MessageProducerCapture } from '../setup/observe-message-producer';
let messageProducerCapture: MessageProducerCapture;
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
        messageProducerCapture ??= captureStartedMessageProducer();
        bootstrapCapture ??= captureStartedBootstrap();
    }
}

let identityOwner: typeof import('../../services/consciousnessEngine').consciousness | undefined;
afterAll(async () => {
    // Runs even if a metric assertion failed. Rejection fails the hook visibly.
    const failures: unknown[] = [...importFailures];
    try { await identityOwner?.ready(); } catch (error) { failures.push(error); }
    try { await observeMessageProducer(messageProducerCapture); } catch (error) { failures.push(error); }
    try { await observePublicBootstrap(bootstrapCapture); } catch (error) { failures.push(error); }
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
