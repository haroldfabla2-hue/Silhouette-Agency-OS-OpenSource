import { MemoryEvidence, type TemporalClaim } from './memoryEvidence';
export interface ClaimSource { id: string; ownerId: string; text: string; observedAt: number }
export interface ClaimCandidate {
    subject: string; predicate: string; object: string; polarity: boolean; validFrom: number; validTo?: number;
    sourceId: string; start: number; end: number;
}
export interface ClaimReview {
    sourceId: string; span: string; verdict: 'EXTRACTIVE_SUPPORTED' | 'REVIEW_REQUIRED'; reasons: string[];
}
/** Bounded extractive critic. Never calls substring matching neural entailment. */
export function reviewCandidate(candidate: ClaimCandidate, source: ClaimSource, ownerId: string): ClaimReview {
    const reasons: string[] = [];
    if (source.ownerId !== ownerId || candidate.sourceId !== source.id) reasons.push('source/owner mismatch');
    const validOffsets = Number.isInteger(candidate.start) && Number.isInteger(candidate.end)
        && candidate.start >= 0 && candidate.end > candidate.start && candidate.end <= source.text.length;
    const span = validOffsets ? source.text.slice(candidate.start, candidate.end) : '';
    if (!validOffsets) reasons.push('invalid evidence offsets');
    for (const value of [candidate.subject, candidate.predicate, candidate.object]) {
        if (!value.trim() || !span.includes(value)) reasons.push('field not grounded in source span');
    }
    if (!Number.isFinite(candidate.validFrom) || !Number.isFinite(source.observedAt)
        || (candidate.validTo !== undefined && (!Number.isFinite(candidate.validTo) || candidate.validTo <= candidate.validFrom))) reasons.push('invalid temporal interval');
    if (typeof candidate.polarity !== 'boolean') reasons.push('invalid polarity');
    // Exact spans alone cannot establish polarity, paraphrase, entity resolution or truth.
    if (/\b(not|never|no|nunca|jamás|neither|sin)\b/iu.test(span) || candidate.polarity === false) reasons.push('negation needs semantic review');
    if (/\b(if|maybe|perhaps|might|could|si|quizás|tal vez|podría)\b/iu.test(span)) reasons.push('conditional or uncertain source');
    return { sourceId: source.id, span, verdict: reasons.length ? 'REVIEW_REQUIRED' : 'EXTRACTIVE_SUPPORTED', reasons };
}
/** Accepted grounding still produces PROPOSED/CONFLICTED claims, never CONFIRMED facts. */
export async function proposeExtractedClaim(registry: MemoryEvidence, candidate: ClaimCandidate, source: ClaimSource, ownerId: string): Promise<{ review: ClaimReview; claim?: TemporalClaim }> {
    const review = reviewCandidate(candidate, source, ownerId);
    if (review.verdict !== 'EXTRACTIVE_SUPPORTED') return { review };
    const claim = await registry.proposeClaim({ subject: candidate.subject, predicate: candidate.predicate, object: candidate.object,
        polarity: candidate.polarity, validFrom: candidate.validFrom, validTo: candidate.validTo, ownerId,
        sourceIds: [source.id], observedAt: source.observedAt, confidence: 0.5 }, [source.id]);
    return { review, claim };
}
