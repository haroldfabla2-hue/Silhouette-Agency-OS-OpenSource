# Boot gates and acceptance credential isolation

## Defects

The boot loader always started the scheduler, even with scheduler/autonomy disabled. Due persisted jobs could reach plan execution, goal derivation or custom action events. stop() left its delayed initial check alive. Persist used CommonJS require inside ESM and silently lost updates. Storage hydration also raced the first check.

The AI loader could restore systemApiKey from SQLite. Removing .env alone was not an offline/credential-free boot. Config JSON, dotenv, inherited environment and active provider accounts were additional credential sources.

## Changes

- Scheduler checks scheduler.enabled AND autonomy.enabled at start, each tick, each task, and before dispatch. GOAL_CHECK also requires enableIntrospection. Unreadable/malformed config denies execution. OFF preserves jobs, ON still executes them. stop cancels both timers. Serialization prevents overlapping checks; hydration completes before dispatch and ESM persistence writes real SQLite.
- Explicit SILHOUETTE_BOOT_MODE=acceptance masks credential sources in process only, skips dotenv, allowlists inherited environment, overrides both config readers to disable channels, providers, external memory modules and autonomy. SQLite credential config reads are masked and writes refused; original records remain intact. Account resolution and OpenAI-compatible client custom env cannot bypass acceptance mode. Normal mode retains credential behavior.
- Invalid boot mode fails closed. There is no deploy, merge, credential rotation or deletion in this change.

## Real checks

Run `python3 tests/real-process/run-boot-checks.py ./node_modules/.bin/tsx` after normal project dependencies are available. The checks launch real child processes with temporary config files, SQLite databases, encrypted token files, bus delivery and 5-second wall-clock timers. No spies, fake timers, mocked modules or provider calls. Evidence: boot-source-checks-20261111.json.

Seven scheduler cases: disabled scheduler, disabled autonomy, disabled introspection goal, enabled custom action, stop, live config revocation through saveConfig, malformed config. Normal and acceptance credential child processes check both loaders, inherited custom env, dotenv, SQLite, active account env, encrypted tokens, explicit client env, and original data/config unchanged. The revocation case intentionally writes only its temporary config through the real config API.

## Limits and rollout

This is NOT full application boot, HTTP, UI, restart-memory, production or complete-suite proof. It does not guarantee no arbitrary egress: code can open sockets without a credential, directly read files or use other custom providers. OS-level network restriction is still required for isolated acceptance. The checks import selected real modules, not the entire application graph. No real user records or keys are included.

Acceptance mode belongs in a separate release directory with disposable database copies, isolated HOME, loopback-only access, and external egress denial. Never point an acceptance run at production data: initialization and maintenance can still write non-credential data. Do not treat an old raw tar of active WAL/Neo4j/Redis as a consistent backup. A coordinated backup and rollback plan, review/approval of this branch, and full isolated application checks remain prerequisites before host activation. Public ingress configuration is a separate change.

## Follow-up: second cron engine and health truth

Full app review found a second scheduler in services/scheduler/cronScheduler.ts, initialized by app.ts. It now checks the same scheduler/autonomy ceilings at initialize/tick/webhook dispatch. A separate real loopback HTTP check verifies OFF, ON and revocation with actual requests; its tick is manually invoked, not a timer test.

An isolated full app process subsequently reached /health, with no production data/credentials, a separate network namespace, read-only outer filesystem and private HOME. It exited through SIGTERM cleanup. This is actual app boot and HTTP evidence, not UI/task end-to-end or production/restart-memory proof. Initial health incorrectly called Redis up when the in-memory fallback answered. A bounded fix now reports the effective fallback as degraded/in-memory-fallback with the data-loss-on-restart caveat. The actual isolated process confirmed HTTP503 and Redis degraded after fallback. Before fallback is established, it can report Redis down; that is not evidence of Redis readiness. See fullboot-health-observation-20261111.json.

Focused lint and frontend/server builds passed locally. Whole-project typecheck remains inconclusive: default heap OOM, a separate enlarged-heap attempt did not finish within the execution bound. Do not activate on a live host or label whole-project validation green on this evidence. Disabled graph/vector services and in-memory Redis do not establish a durable memory environment.


## Actual WORKING-memory process restart and CI diagnosis

A real fixture was stored through POST /v1/memory/store, retrieved once through GET /v1/memory/state, the app was terminated with SIGTERM and restarted as a different process. The same exact node ID/content appeared once after restart. Both processes terminated. This establishes the tested WORKING-memory snapshot path in a disposable acceptance copy, NOT four-tier retention, Redis durability, semantic search, real user data, UI end-to-end or complete product proof. Reproduction source and result are in tests/real-process/full-app-memory-restart.py and working-memory-restart-20261111.json.

Local full typecheck exceeds available heap (951 MiB default, 1400 MiB attempt OOM on a 2 GB environment). A dependency-light changed-leaf check passes but does not replace the global check. Current CI at commit 368bb76 on Node22 ran whole-project Type check successfully in16s and global lint successfully. Its next step, Chromium installation, failed because ubuntu-latest had moved to Ubuntu26.04 while locked Playwright1.58.2 explicitly rejected that OS. This is not a typecheck/test success for the whole job; unit tests were skipped. CI now pins Ubuntu24.04, which the installed locked Playwright registry explicitly supports; no browser tests skipped or weakened. The next CI result remains pending.
