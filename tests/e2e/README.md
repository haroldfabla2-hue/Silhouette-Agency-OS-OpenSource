# Fase 5 - Soak / E2E protocol

Scaffolding for the plan's Fase 5 ("Demostrar continuidad y estabilidad").
Everything here runs for real in local-first mode today; the 24h soak is the
same runner with a longer clock, and it requires decisions that belong to
Alberto (not to the agent):

- Neo4j/Redis hosting (full mode)
- LLM provider + budget (inspected prompts, per-call cost)
- External-channel credentials

## What runs today (local-first, SQLite only)

    # write phase and read phase as separate OS processes (real restart between)
    npx tsx tests/e2e/soak/runSoak.ts --phase=a --db=/tmp/soak.sqlite --evidence=/tmp/ev.jsonl
    npx tsx tests/e2e/soak/runSoak.ts --phase=b --db=/tmp/soak.sqlite --evidence=/tmp/ev.jsonl

    # continuous cycles (smoke: seconds)
    SOAK_DURATION_MS=8000 SOAK_CYCLE_EVERY_MS=300 \
      npx tsx tests/e2e/soak/runSoak.ts --mode=soak --db=/tmp/soak.sqlite --evidence=/tmp/ev.jsonl

Every step appends one JSONL line: `{ts, scenario, phase, result, detail, metrics?}`
with `result` in `PASS | FAIL | NOT_RUN`. Scenarios that cannot run in this
environment are `NOT_RUN` with the reason - never simulated.

Covered today: memory durability across real process restarts with provenance
(R5), incident open/resolve as one episode (R6), per-call cost logging that
survives restarts, cycle cadence with monotonic timestamps.

## The 24h soak (pending Alberto's decisions)

    SOAK_DURATION_MS=86400000 SOAK_CYCLE_EVERY_MS=60000 \
    SOAK_RESTART_EVERY_MS=3600000 SOAK_MODE=full \
      npx tsx tests/e2e/soak/runSoak.ts --mode=soak --db=/var/lib/silhouette/soak.sqlite --evidence=/var/log/silhouette/soak.jsonl

Protocol per the plan document:

1. Full autonomous frequency configured, no hidden throttling.
2. Both modes: local-first, then full with Neo4j/Redis once hosting exists.
3. During the 24h: process restarts on the restart cadence (the harness
   re-launches the runner on the same DB), one API key, induced
   failures/reconnections, new sessions, approval/rejection round-trips,
   pending objectives verified after each restart, per-call cost recorded.
4. Real captures: evidence JSONL, inspected prompts, per-call metrics.

Declared NOT_RUN locally (need full server / Alberto decisions):
approval-rejection, new-chat-sessions, inspected-prompts,
full-mode-neo4j-redis, external-channels.
