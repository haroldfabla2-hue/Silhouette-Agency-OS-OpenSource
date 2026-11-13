#!/usr/bin/env bash
# Proposed existing CI Node22.18/npm-ci static beat only. No app imports/workload.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
repo=$PWD
node -e 'if(process.versions.node!=="22.18.0") throw Error("Expected existing CI Node22.18.0")'
test -d node_modules
test -f node_modules/typescript/bin/tsc
out=${1:?new evidence directory required}
mkdir "$out"
# Existing npm ci must already have run for this exact checkout/package-lock.
# No npm install/ci/update/network/provisioning is performed by this script.
git rev-parse HEAD > "$out/source-head.txt"
sha256sum types.ts services/sqliteService.ts package.json package-lock.json services/continuumMemory.ts services/memoryTransitions.ts services/introspectionEngine.ts tsconfig.json tsconfig.introspection-fixture.json tests/real-process/introspection-initial/initial-status-consumer.mts tests/real-process/introspection-initial/ci-static.sh tests/real-process/introspection-initial/run-two.py tests/real-process/introspection-initial/run-runtime.sh tests/real-process/disk-restart/child.mts tests/real-process/disk-restart/run-restart.py tests/real-process/disk-restart/run-runtime.sh services/dreamerService.ts services/brain/brainMemoryBridge.ts db/migrations/sqlite/001_baseline_indexes.down.sql db/migrations/sqlite/001_baseline_indexes.up.sql db/migrations/sqlite/002_facts_table.down.sql db/migrations/sqlite/002_facts_table.up.sql db/migrations/sqlite/003_user_profiles.down.sql db/migrations/sqlite/003_user_profiles.up.sql db/migrations/sqlite/004_incidents.down.sql db/migrations/sqlite/004_incidents.up.sql tests/real-process/mcp-effect/child.mts tests/real-process/mcp-effect/run-effect.py tests/real-process/mcp-effect/run-runtime.sh services/identityService.ts services/mcp/mcpClient.ts server/middleware/authMiddleware.ts server/routes/v1/autonomy.routes.ts services/actionExecutor.ts services/security/effectGate.ts services/security/gatedExecution.ts services/security/principalContext.ts services/security/approvalGrants.ts services/security/effectContext.ts tests/real-process/provider-health/child.mts tests/real-process/provider-health/run-probe.py tests/real-process/provider-health/run-runtime.sh services/providerHealthManager.ts services/narrativeService.ts tests/automated/pr4a-llm-chain.test.ts tests/automated/workflow-mission-route.test.ts services/geminiService.ts services/media/imageFactory.ts services/planExecutor.ts server/controllers/chatController.ts tests/verify_circuit_breaker.ts services/embeddingResolver.ts services/geminiClientState.ts tests/automated/deep-memory-identity.test.ts tests/automated/fase1-embeddings-honest.test.ts > "$out/input-sha256.txt"
# Timeouts FAIL, no relaxed existing gates or new full-suite invocation.
timeout --signal=TERM --kill-after=5s 180s npm run lint 2>&1 | tee "$out/lint.log"
timeout --signal=TERM --kill-after=5s 180s npm run typecheck 2>&1 | tee "$out/tsc-production.log"
timeout --signal=TERM --kill-after=5s 180s node node_modules/typescript/bin/tsc --project tsconfig.introspection-fixture.json 2>&1 | tee "$out/tsc-fixture.log"
printf 'STATIC_PASS\n' > "$out/static-pass.txt"
