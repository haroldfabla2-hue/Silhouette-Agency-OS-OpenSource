## Why

Alberto's directive (2026-10-14): "sí constrúyelo" — a way to give the autonomous loop **real missions**. Today `startNewCycle()` always begins with an empty intent: 24/7 mode re-reads the last chat message from volatile memory, and chat missions never enter the workflow at all. There was no API to seed one.

## What

**`POST /v1/workflow/mission`** — seeds a real mission into the autonomous loop:

- `startMission(mission)` on the workflow engine: refuses to interrupt a cycle in flight (`409 MISSION_BUSY`), enables the engine for the run (`mode24_7` untouched), starts a fresh cycle at `INTENT_ANALYSIS`, and seeds `pipelineData.input`.
- `analyzeIntentAndResearchNeeds()` now prefers the seeded mission over volatile memory; the old memory fallback is intact for 24/7 mode.
- Best-effort audit trail: the mission is stored in continuum memory tagged `['mission', 'user-input']`; a store failure never blocks the start. Nothing is ever deleted (eternal-memory invariant).
- Validation: `mission` must be a non-empty string of at most 2000 chars (`400` otherwise). Returns `202` with the new stage on success.

## Tests

`tests/automated/workflow-mission-route.test.ts` (4/4 green, real express + http, no mocks):

- 400 on missing / empty / non-string / over-length bodies
- 202 starts the cycle at `INTENT_ANALYSIS`, seeds `pipelineData.input`, enables the engine for the run, leaves `mode24_7` off
- 409 while a cycle is in flight — never interrupts it
- Source guard: INTENT analysis prefers `pipelineData.input`; route and `startMission` exist

`tsc --noEmit` clean.

## Live verification (production server)

Deployed runtime-ahead and exercised against the real system: `POST /v1/workflow/mission` with a real mission drove a full observable cycle in the server log (`INTENT_ANALYSIS → STRATEGIC_PLANNING → EXECUTION_SWARM → QUALITY_ASSURANCE_AUDIT → ...`), tokens consumed, and `GET /v1/workflow/stage` reflected each transition. Evidence in the task report.
