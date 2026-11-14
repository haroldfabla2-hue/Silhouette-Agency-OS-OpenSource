# Recovery mapping before aggregate changes

The core still conservatively treats lifetime failures as INCOMPLETE. No retry success or acknowledgement changes that criterion in this checkpoint.

Recovery must name one exact admitted obligation and preserve the original attempt error. Later success must fulfill that SAME requirement with relevant inputs unchanged. An unrelated operation, a later service-wide healthy flag, an acknowledgement, or a successful canonical write does not establish recovery. Every resource acquired by failed attempts must additionally have actual CLOSED verification before any recovered-clean classification.

| Product branch | Canonical result | Historical attempt | Selected requirement / residual |
| --- | --- | --- | --- |
| Graph verify retry then connect true | Original true | Original attempt error and failed candidate retained | Connection requirement may be satisfied by later same-operation attempt; failed candidates remain residual until verified CLOSED. Schema is separate. |
| Graph selected schema error, E1 | connect stays true | Exact schema failure retained | Selected schema remains failed even if connected flag is true. Session-close failure independent. |
| Redis upgrade then Memory fallback | Existing availability fallback unchanged | Exact upgrade failure retained | Availability may be recovered only where that callsite accepts Memory. Required Redis durability is not recovered by Memory. Partial clients remain residual. |
| Power failed load, E2 | callback fulfills, multiplier1 | Exact read error | Fallback does not perform selected load measurement. Remains failed. |
| Vector sync after canonical commit, E5/E12 | canonical node unchanged | Exact sync failure/skip | Selected projection failed/no-write. Do not replay canonical commit or label it failed. |
| Reinforcement requeue, E6 | original queued return unchanged | Original batch error and item identities | Same selected items need actual mutation receipt; queued/requeued/expired is not durable completion. |

Independent unchanged product axes: ownership/alias exclusion; SIGKILL successor; original-error/PENDING/idempotency; measured latency; accepted-join restart; accepted-post-delivery-failure restart. The two accepted runtime cases still FAIL naturalexit30s and their restart assertions were not reached. This source does not change any historical outcome.

Proposed record linkage: exact obligation identity -> attempt IDs -> immutable errors plus exact acquired resource IDs -> later fulfillment evidence for the same input identity -> join with host's actual resource release evidence. These are not boolean `recovered=true` setters. Parameter equivalence must be per callsite, not guessed from an equal label. No aggregation change until the coded mapping and its original ownership edges are reviewed.

## Checkpoint3 source representation

`recoveryEvidence.ts` now retains an exact operation+input-identity obligation, immutable attempt IDs with original host failure-ID/revision/source links, actual host-owned acquired resource IDs, a distinct later original-result fulfillment record with attempted IDs, and a join to the host's collected resource release evidence. Graph connect uses this record for its actual retry loop. Early already-connected/disabled/cooldown guards do not invent a retry obligation. A different operation, input object or borrowed resource rejects.

Input equivalence remains explicitly UNVERIFIED. Current Graph inputs preserve retries/delay/force identity, not certified environment/credential/principal equivalence. Every observation verdict stays NOT_CERTIFIED. No success/service health flag or acknowledgement clears the attempt. Host aggregate still uses lifetime failures and global unsafe remains permanent. This is a reviewable linkage, not recovery certification.

Records and total attempt links are each bounded by the explicit failure-capacity input; there is no numeric default. No Error reference is retained twice across acknowledgement: recovery history holds immutable host failure references, and only the host's failure list retains the original Error until exact acknowledgement. Resource join contains only actual host-collected releases and never inserts a missing CLOSED receipt. Lifetime retirement/reclamation of successful obligation records is still unresolved alongside per-instance scope retirement.

## Checkpoint5 input comparison

Graph now captures the six actual SDK argument primitives in the same evaluation order and positions: URI, auth user, auth secret, max lifetime, pool size and acquisition timeout. No extra environment reads or earlier snapshot changes the original retry behavior. Only equality results enter fulfillment evidence. Actual values never enter recovery records/reports; private invocation-local baseline is cleared on fulfilled/terminal return. A partial throwing auth/SDK allocation makes equivalence UNVERIFIED. Complete equal input sets for every attempted SDK construction may record GRAPH_DRIVER_INPUTS_EQUAL in the fixed Graph source scope.

This does not certify external backend/principal stability, native dependency behavior, query/schema effects or failed-resource CLOSED receipts. The operation's retries/delay/force remain the same immutable obligation inputs. Verdict stays NOT_CERTIFIED and aggregate remains conservative. The fixed source topology is not hostile same-realm authorization; the enum alone is not proof without this reviewed callsite.
