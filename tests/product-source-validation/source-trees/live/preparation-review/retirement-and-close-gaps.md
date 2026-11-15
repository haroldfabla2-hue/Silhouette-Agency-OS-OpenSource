# Lifetime and public-close compatibility gaps

This source candidate is PARTIAL and not executable. These records do not grant authority or change any runtime result.

## Scope capacity is currently a lifetime bound, not a concurrent-instance bound

`#scopes` and provisional `#constructions` retain every admitted instance. No scope is currently retired/recycled. Repeated independent construction therefore exhausts the explicit input even after objects cease to be useful. Increasing a cap, dropping a failed scope, relying on GC or silently sharing its scope are not fixes. No production cap is supplied.

A safe per-instance retirement needs a source-fixed disposal boundary at each real independent caller. It must seal that instance's callbacks/producers, join its exact admitted operations and reserved descendants, keep borrowed clients alive, and verify all its actual owned resources. Failed/unknown obligations stay independently retained under immutable IDs until exact acknowledgement. Only the instance's proven finished operational bookkeeping can retire; failure history and canonical/effect outcomes cannot be evicted to admit a successor.

Checkpoint4 now adds bootstrap-only Host.retire(scope), per-scope active-operation/reservation tracking, scope-local open/seal, exact same retirement task, producer callbacks once, and joins admitted descendants before returning. Host.stop joins any already started retirement, not a second producer-stop invocation. Services do not receive retirement or stop authority. This is real instance sealing/join integration, NOT proven slot reclamation.

The core still cannot establish full borrowed-reference/source-disposal proof; public-close evidence is not a completed instance-retirement receipt. Retirement therefore returns INCOMPLETE with a concrete reason and does not release resources, delete scopes/constructions, or recycle capacity. Adding `#scopes.delete` now would be false reclamation. This is an explicit unresolved integration blocker, not a working concurrent-capacity policy. Recovery records/resources remain lifetime-retained too.

## Complete syntactic close inventory, not complete receiver analysis

`public-close-inventory.json` inventories all member calls to close/disconnect/quit/destroy/end/dispose/shutdown/stop and method declarations in the inspected source tree. It deliberately retains network response.end, test fixtures, business stop APIs and other false positives rather than dropping an unresolved owner by name. Computed members, extracted/bound function aliases, reflection, plugin/dependency code and source/build differences remain open.

Known changed owner requests are SQLite.close and RedisBusAdapter.disconnect. Strict `active.size === 1` and the permanent global-unsafe guard prevent unsafe release, but do not prove final function compatibility or legitimate live public-close behavior. Do not adopt these guards as the final product API.

Known public/shared paths that still require actual callsite lifetime integration:

- SQLite: raw exported `.db` permits consumers to bypass ownership. Two real-process child callsites were source-migrated to `.close()`, without executing them. Other direct imported aliases must be resolved; exposing the actual DB identity cannot be replaced by a proxy silently.
- Graph: public disconnect/close, idle timer disconnect, nervous-system reconnect, query-error driver close/retry, all query/schema sessions. Driver candidates retained by the host do not make these direct closes safe or idempotent with host teardown.
- RedisService: fallback cleanup and public disconnect operate on its field; partial client allocation/reconnect callbacks and commands still need retained ownership and quiescence. It is not the RedisBusAdapter's client and must not be closed by the bus.
- Bus: two owned adapter clients, upgrade-in-flight replacement, subscriptions/request/retry timers and public shutdown must join their own operation lifetimes. A subscription registry is not proof that all callbacks settle.
- LanceDB: all real connections/table handles/native indexes and optimize callbacks require per-instance disposal; independent test constructors cannot borrow singleton disposal.
- Brain bridge: supplied client may be borrowed; request completion is not client/transport ownership. A no-op bridge constructor does not prove all requests are retired.
- AccountStore, ProcedureApprovalLedger, ToolPersistence and real-process fixture stores have independent owners. Do not route every `.close()` to one service host.

Next safe source step is resolving the inventory by receiver binding and caller lifetime, then encoding per-instance admission/disposal boundaries. The current unsafe marker stays global. No borrowed close, premature release, forced advancement or capacity auto-eviction is allowed.


## Checkpoint7 admitted response delivery

Only exact pre-admitted HELP_RESPONSE request callbacks can cross seal; original help routing fixes its two subsequent bus branches before the dependency await. Other event/cross-scope descendant paths are still open. This is not proof that an accepted agent task finishes after seal. Shared help response-fact processing and queued mailbox contents remain explicit residuals. Eight Graph children per concurrent query and actual Redis error-event frequency must be included when later grounding explicit capacity inputs. No cap was invented or raised here.


## Checkpoint8 TTL and command ownership

Each original Redis command retains its actual body and lazy connect under the same operation. One exact fallback-lock-expiry reservation is charged before the first await for acquireLock, even when the later actual remote/lock guard will skip it. A selected TTL remains pending until its original timer runs; no forced cancellation is claimed as completion. Long TTLs and cross-owner descendant admission remain real natural-exit constraints. Codebase's new explicit independent scope still has no proven lifetime slot-reclamation policy.


## Checkpoint10 local close identity versus quiescence

Graph's candidate-local original native close is now a single shared attempt across direct original caller sites and host teardown. First invocation's result/Promise/error identity is preserved. Repeated calls reuse it, an explicitly changed one-shot release contract under review rather than a claim that retrying close was always equivalent. No quiescence was inferred. Each direct request is residual and lifetime/borrow/reconnect races remain blockers. SystemBus now removes handler identity from the actual prior/current adapter list; this deliberate local bugfix does not certify the async upgrade's full postseal admission frontier.


## Checkpoint11 correction to Neo4j retry contract

The prior single-rejection memo proposal is superseded. Actual reviewed Neo4j6.0.1 may complete cleanup on a later sequential close. Candidate state now shares only pending/fulfilled result, permits a new original sequential call after rejected/synchronous-failed attempt, and retains every failed attempt. Core bypass is restricted to exact Graph driver resource source; no generic retry policy. Fulfilled close is separate from quiescence and earlier failure history, both still preserved. SystemBus correlated-request timeout is separately retained even if the request Promise rejects earlier; genuine timeout/backoff timings are unchanged.
