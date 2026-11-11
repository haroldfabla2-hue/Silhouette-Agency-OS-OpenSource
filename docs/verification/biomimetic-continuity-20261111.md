# Biomimetic continuity: two reproduced ingress defects, 2026-11-11

This is a partial repair, not proof of a thinking, learning or autonomous product.

## Original requirements

The owner asked on October 12 for real thought and biomimetic behavior, and for introspection to remain distinct from user and agent speech. On October 13 he asked for lasting memory and gradual identity evolution grounded in accumulated experience. On October 14 he described logs interpreted into memory as the input to later insights, curiosity and evolution.

## Reproduced with actual services

In disposable process/filesystem/network namespaces, providers OFF, without production data or LLM calls:

- A real `experienceBuffer.recordFailure` produced one recorded failure but `LearningLoop.getRecentFailures` selected zero. It called nonexistent `getRecentExperiences` and expected `result`, while the actual service exposes `getRecent` and `type`. The fix selects actual bounded current-process failures and maps original outcome/lesson fields. The positive probe selects one failure, excludes a real recorded success and refuses an invalid time window. This does not prove durable experience recovery or generated/applied improvements.
- Two distinct real narrative inputs sharing a 60-character prefix produced one queued item and zero memory records before provider processing. The fix records source events before presentation dedupe/throttle/provider work and compares complete content for presentation dedupe. Actual Continuum search then returned both original events and both remained queued. Raw events are tagged `source:SYSTEM` and `RAW_SYSTEM_EVENT`, not user speech, interpreted introspection or verified epiphanies. This is a source-preservation repair, not proof of successful semantic interpretation. Persistence still follows existing best-effort/error-reporting behavior.

The executable probe is `tests/real-process/biomimetic-ingress-child.ts`. It must run inside a disposable filesystem and network namespace with providers OFF. It never starts provider generation. Baseline failed assertions were retained separately from positive logs.

## Validation

Complete existing automated suite after these code changes: 1459 passed, 0 failed, 2 skipped, 225 files passed and 1 skipped, 92.83 seconds. It includes pre-existing doubles and source-text checks, so this is not a zero-mock or full biomimetic E2E claim. Both new actual-service process probes passed separately. Global lint: zero errors, 420 existing warnings.

An initial full-suite attempt used the wrong isolation environment: a read-only `.env.local`, missing loopback setup and the production provider gate. It failed and timed out, and is not counted as validation. Re-running the whole suite with the established hermetic test harness passed. Typecheck with a 1400 MB heap aborted for memory exhaustion and is not a pass. A larger isolated typecheck remains outstanding, as do full build controls for this branch.

## Still open

Narrative interpretation/provider-failure recovery, durable failure replay, measured insight quality, memory four-tier retention and contradiction reversibility, actual evidence feeding identity over time, curiosity finding and resolving a gap, and verified improvement outcomes are not established by these fixes. Current Dreamer code records cycle metrics in `finally`, including insufficient-memory and error paths; that separate issue has not yet been functionally tested or repaired here. No merge, host deployment, provider/autonomy activation, sandbox install or training is included.
