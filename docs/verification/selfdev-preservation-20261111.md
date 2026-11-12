# Isolated candidate preservation and pending learning links

Candidate follows a3d5c8c. Branch-only, no deployment, no runtime activation.

## Demonstrated defects and boundaries

1. The existing selfwork sync discarded modified and untracked candidate files
   with reset/clean. A real temporary git repository with authored changed bytes
   reproduces this on the parent source: the new preservation test fails because
   sync succeeds and discards the candidate. The candidate refuses that sync,
   preserves source bytes in place, and records exact base/diff/file bytes with
   a SHA-addressed, private, read-back-verified snapshot. Unreadable, denied,
   oversized, linked or ignored artifacts block sync rather than being discarded.
   The source checkout is never reset. No automatic cleanup or rollback is claimed.
2. Existing real LanceDB stale-handle regression failed with the actual binding's
   lowercase "not found" error. Matching that narrow IO signature without case
   sensitivity makes the unchanged functional regression pass. No vector or
   collection migration occurs.
3. A proposal receipt only in WORKING/RAM was insufficient for durable replay
   under concurrent startup snapshots. Proposal receipts now use canonical
   MEDIUM storage with readback and without ingestion. Their content is a proposal,
   not executable authority.

## Existing product domain, not a new apply mechanism

The scheduler and learning route share the same fixed declared mappings:
continuum-promote and continuum-embeddings. No source, scope, acceptance target,
privilege or permission is chosen by confidence or planner text. A real open
SQLite incident and read-back proposal memory link to a durable cycle.

The non-reserving PROPOSAL_PENDING cycle records HUMAN_APPROVAL_PENDING, applied:false and
BASELINE_ORACLE_REQUIRED. Restart/replay reuses the durable memory and cycle IDs.
It calls no planner, accepts no patch and creates no PR request. Pending proposals do not reserve the shared clone or consume ordinary execution caps. Their independent storage bound is five new proposals/day and five unresolved proposals. They can be abandoned through the existing lifecycle, retaining linkage and journal; replay never resurrects an abandoned proposal. Execution caps are unchanged. It cannot report
PATCH_VERIFIED_ISOLATED or APPLIED_RUNTIME, and never increments autoApplied.
The present deep-memory-identity acceptance target contains static checks and is
not an independent functional oracle. The pending link deliberately refuses
execution/PR certification until that missing boundary has a real implementation
and a reproduced useful fault. Operator-authored fixtures prove only mechanics.

## Test contract change

The old worktree-sync test explicitly expected dirty files to be discarded.
It now asserts their exact survival, unchanged HEAD, preserved evidence, and no
later cycle overwrite. Fresh clean worktree sync and missing-upstream failure
checks remain. This is a stronger preservation contract, not weakening a failing
functional assertion. The original source's red result is retained separately.

## Verification at review cut

- Real git/FS focal: 11 passed; source baseline preservation failed as expected.
- Real SQLite/memory/cycle in two fresh processes: passed with stable IDs and
  zero planner calls, patches, PRs and applied-learning successes.
- Unchanged real LanceDB regression plus sync tests: 6 passed after IO matcher fix.
- Lint: 0 errors, 421 warnings (includes two disposable harness warnings).
- Frontend build: passed, 21.51s. Server build: passed, 4.50s.
- Several whole-suite local attempts reached the 116s harness cap; none counts
  as completed validation. The final complete suite and typecheck remain gated
  on the exact-SHA public standard-runner job, one attempt, with OFF providers
  and isolated runtime. No local typecheck success is claimed.

## Limits

Candidate snapshots are not multi-process writer locks or complete runtime
rollback. Existing generic selfdev tests run editable code and cannot certify
independent learning. No positive generative planner or runtime-applied useful
learning is demonstrated. No production data, secrets, cloud providers or charges
were used. No main merge, PR creation or deployment is authorized by this cut.
