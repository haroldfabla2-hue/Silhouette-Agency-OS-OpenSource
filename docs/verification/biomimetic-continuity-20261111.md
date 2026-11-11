# Biomimetic continuity: two reproduced ingress defects, 2026-11-11

This is a partial repair, not proof of a thinking, learning or autonomous product.

## Original requirements

The owner asked on October 12 for real thought and biomimetic behavior, and for introspection to remain distinct from user and agent speech. On October 13 he asked for lasting memory and gradual identity evolution grounded in accumulated experience. On October 14 he described logs interpreted into memory as the input to later insights, curiosity and evolution.

## Reproduced with actual services

In disposable process/filesystem/network namespaces, providers OFF, without production data or LLM calls:

- A real `experienceBuffer.recordFailure` produced one recorded failure but `LearningLoop.getRecentFailures` selected zero. It called nonexistent `getRecentExperiences` and expected `result`, while the actual service exposes `getRecent` and `type`. The fix selects actual bounded current-process failures and maps original outcome/lesson fields. The positive probe selects one failure, excludes a real recorded success and refuses an invalid time window. This does not prove durable experience recovery or generated/applied improvements.
- Two distinct real narrative inputs sharing a 60-character prefix produced one queued item and zero memory records before provider processing. The fix records source events before presentation dedupe/throttle/provider work and compares complete content for presentation dedupe. Actual Continuum search then returned both original events and both remained queued. Raw events are tagged `source:SYSTEM` and `RAW_SYSTEM_EVENT`, not user speech, interpreted introspection or verified epiphanies. This is a source-preservation repair, not proof of successful semantic interpretation. Persistence still follows existing best-effort/error-reporting behavior.

The executable probe is `tests/real-process/biomimetic-ingress-child.ts`. It must run inside a disposable filesystem and network namespace with providers OFF. It never starts provider generation. Baseline failed assertions were retained separately from positive logs.

## Empty dream completion accounting

A third actual-service probe began with an empty disposable store and called `attemptDream`. It returned without sufficient memories, but its `finally` block recorded one completed cycle. The fix records completed-cycle metrics only after actual synthesis returned a verdict and source memories reached the processing boundary; it does not reset accumulated work or update the cooldown on an empty or failed attempt. The real empty-store probe now records zero. This negative-path proof does not establish a successful provider-backed dream, semantic quality, or durable consolidation.

## Validation

Complete existing automated suite after all three code changes: 1459 passed, 0 failed, 2 skipped, 225 files passed and 1 skipped, 91.62 seconds. It includes pre-existing doubles and source-text checks, so this is not a zero-mock or full biomimetic E2E claim. All three new actual-service process probes passed separately. Global lint: zero errors, 420 existing warnings before the third change; final changed-file lint also has zero errors and two existing Dreamer warnings. Frontend and server builds passed (21.54 seconds and 4.32 seconds). Global typecheck passed in a private-network service over the verification source copy with read-only dependencies and a 2560 MB heap; no application imports or production data were used as inputs.

An initial full-suite attempt used the wrong isolation environment: a read-only `.env.local`, missing loopback setup and the production provider gate. It failed and timed out, and is not counted as validation. Re-running the whole suite with the established hermetic test harness passed. A local typecheck with a 1400 MB heap aborted for memory exhaustion and is not a pass. The first remote typecheck could not find dependencies because its read-only dependency mount was missing. The corrected isolated typecheck passed; no source error was suppressed.

## Still open

Narrative interpretation/provider-failure recovery, durable failure replay, measured insight quality, memory four-tier retention and contradiction reversibility, actual evidence feeding identity over time, curiosity finding and resolving a gap, and verified improvement outcomes are not established by these fixes. The Dreamer completion-accounting fix has only negative-path actual-service evidence so far. No merge, host deployment, provider/autonomy activation, sandbox install or training is included.
