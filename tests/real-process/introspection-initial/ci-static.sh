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
sha256sum package.json package-lock.json services/continuumMemory.ts services/memoryTransitions.ts services/introspectionEngine.ts tsconfig.json tsconfig.introspection-fixture.json tests/real-process/introspection-initial/initial-status-consumer.mts tests/real-process/introspection-initial/ci-static.sh tests/real-process/introspection-initial/run-two.py tests/real-process/introspection-initial/run-runtime.sh > "$out/input-sha256.txt"
# Timeouts FAIL, no relaxed existing gates or new full-suite invocation.
timeout --signal=TERM --kill-after=5s 180s npm run lint 2>&1 | tee "$out/lint.log"
timeout --signal=TERM --kill-after=5s 180s npm run typecheck 2>&1 | tee "$out/tsc-production.log"
timeout --signal=TERM --kill-after=5s 180s node node_modules/typescript/bin/tsc --project tsconfig.introspection-fixture.json 2>&1 | tee "$out/tsc-fixture.log"
printf 'STATIC_PASS\n' > "$out/static-pass.txt"
