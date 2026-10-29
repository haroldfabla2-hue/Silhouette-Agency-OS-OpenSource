# Principal isolation: bounded candidate, 29 October 2026

Base: PR202 d616c91b793e2babb1f885c09a3a4f677d4c48b7. Not the lost repair composition. Main remains unchanged. No merge/deploy authority.

Observed baseline: any authenticated human could list and decide every pending action. Existing HTTP tests replace identity and executor and have only one identity. New test uses real temporary identity SQLite users/sessions, HTTP auth middleware and ActionExecutor, without provider calls. Baseline same test failed on cross-user listing; its second test timed out waiting for an improperly attributed system-token pending request (retained failed log, not called product success).

Candidate: authenticated HTTP principal in AsyncLocalStorage, no identity from action/model payloads. Pending records bind requesting principal; listing/decisions filter it. Shared system token has no human principal and cannot mint a human approval request. Low-risk actions retain existing execution rules. Expiry checked on decisions; completed decision clears timeout. Full confirmation payload no longer emitted on a globally broadcast SystemBus event: only a non-sensitive pending-changed notification. Details remain in the scoped HTTP endpoint.

Targeted verification before this commit: six files / 63 tests pass with retries disabled, isolated network namespace/loopback, no credentials/providers. Changed-scope lint: zero errors, one existing warning. Actual two-user test uses real identity/executor; other existing tests contain declared doubles and are not capability evidence.

OPEN, do not claim security completion:
- This is application-session isolation, NOT OS-user/process/agent-writable-code isolation. A same-process caller can still import authority functions. No proof of two independent OS users or protected human issuer.
- Missing authenticated principal now refuses to create a confirmation, visibly. Deferred/daemon/channel operations need a grounded owner route, not a fabricated default owner or a payload claiming identity. Their authorized execution must not be silently lost. Standing grants/campaign authority not implemented here.
- Gateway has system-token sessions, not per-human sessions; pending notification hides details but is not end-to-end multi-user gateway support. Other events remain unaudited.
- No full suite, typecheck, provider delivery or product boot proof yet. No merge readiness claim for PR202.
- No memory/autonomy/biomimetic features intentionally removed, no new spending path; paused work/recovery semantics still require caller audit.
