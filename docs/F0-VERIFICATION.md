# F0 verification status

## Help cycle

`request_collaboration` now receives the executing caller separately from LLM arguments, emits `requesterId`, `requesterRole`, `problem` and a unique `requestId`. The orchestrator registers both HELP_REQUEST and HELP_RESPONSE handlers through the tested `helpProtocol` module. Preparation/hydration errors and missing specialists return explicit correlated failures. Helper streams emit a response on completion or exception. The response reaches the requester mailbox, and incoming messages wait for busy streams rather than being discarded.

A `queued` tool result confirms only enqueueing, never completed collaboration. The integration test uses the real memory transport and a real file-reading helper; it does not prove LLM quality, cloud-provider availability or distributed Redis delivery. Existing conversation-session messages also use HELP_REQUEST, but have a separate session payload and are not treated as collaboration requests.

## Manual checks and CI

All TS `verify_*` scripts under scripts, tests and tools/debug are inventoried in `tests/verification-manifest.json`. CI rejects an unclassified new verifier. Three scripts have hermetic production-module assertions ported into `legacy-hermetic.test.ts`: clock/context, catalog filters, and isolated disk registry persistence. They run on every PR, explicitly in CI and in the normal Vitest suite.

The other scripts are NOT green or validated simply because they are inventoried. Many print failures and exit 0, replace services, copy logic, access a running server, call paid LLMs, need GPU/ComfyUI/Ollama/Neo4j/Qdrant, modify local data, or attempt self-repair. Bulk-running them in untrusted PR CI would be unsafe and misleading. Existing automated tests remain unchanged; the inventory does not claim to replace their coverage.

For `service-required`, start a disposable authenticated Silhouette server, configure its URL and credentials without production data, and replace catch-and-log with nonzero failure assertions before CI admission. For `runtime-review`, inspect imports and supply isolated storage plus the relevant model/database/hardware. For `isolated-runtime`, use a disposable checkout/container with no production secrets and retain safety gates. For `rewrite-required`, remove copied algorithms/service replacements and import the production module under test. No secret-bearing workflow runs on fork PRs.

The Python `silhouette/scripts/verify_ingestion.py` is outside the TypeScript inventory and requires the separate Python ingestion environment. It has not been executed or ported by this change.

Full migration of every legacy script remains work, not completion of F0. Do not advertise full autonomous organization, self-repair, or production readiness from these transport tests.
