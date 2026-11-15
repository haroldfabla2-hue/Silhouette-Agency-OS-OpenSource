# Owner and issuer boundary: preparation only

Status: design requirements, not implemented protection. No deployment, account
change, grant, owner assignment or infrastructure activation is authorized by
this document. Existing code remains fail-closed where principal is missing.

## Current evidence

- `server/channels/channelRouter.ts:handleIncoming` resolves a channel/sender
  through identityService but sends USER_MESSAGE data on SystemBus. Role is not
  consent. `services/bus/RedisBusAdapter.ts` serializes JSON and receives it on
  pub/sub, so an AsyncLocalStorage wrapper around emit cannot carry authority.
- `services/orchestrator.ts:handleUserMessage` passes role to processToolCalls,
  without the authenticated principal/conversation context used by HTTP chat.
- `services/security/approvalGrants.ts` exports a writable in-process issuer;
  `services/security/effectGate.ts:issueEffectGrant` is importable. Module names,
  private TypeScript members and same-user file permissions are not a boundary
  against code/tool execution with equivalent privileges.
- `services/tools/confirmationGate.ts` stores decisions in pending-effects.json.
  Its local exact-call mechanism is not an independently protected issuer.
- The daemon has no source-grounded durable owner for each initiative. Assigning
  CREATOR, first user, an environment name or an action payload would invent one.

## Required separation

Human authentication and approval issuer must run outside the executor's write
and credential domain. Tool workers must not read issuer private keys, change
issuer code/config/decision ledger, or impersonate a human session. The final
provider boundary must verify and atomically consume authority, not trust an
upstream caller saying it already did. A separated issuer alone is insufficient
if the worker retains unrestricted provider credentials or unrestricted egress.

An isolated local experiment can test these contracts later, but two sessions,
two modules, containers sharing writable authority, or a user namespace mapping
one host UID to root are not evidence of two independently protected OS users.
Environment selection/activation and any live migration remain separate gates.

## Channel provenance envelope (proposed contract, not permission)

The authenticated channel ingress would issue an envelope containing version,
issuer/key ID, unique nonce, issued/expiry times, channel account and sender
binding, stable message ID, principal ID, conversation ID, and content digest.
Receiver verifies signature against a pinned public key and checks persistent
replay state before using it. Redis data, model output, role labels and tool args
cannot choose a trusted issuer/key or alter the envelope's principal. A signature
proves attributable ingress only. It does not approve effects or spending.

Account binding changes, revoked sessions and revoked channel associations need
explicit revalidation policy at the issuer. Old signed messages cannot silently
become new approval commands. Exact user-command parsing and full action display
must precede any decision; quoted or tool-authored command text is never a human
approval. The design must cover group audiences and distinct conversation IDs.

## Ownerless initiatives and unresolved consent

Preserve proposal ID, origin, full intent/action, creation time and unresolved
reason. Do not dispatch, mark rejected, select a default owner or silently drop
accepted work. Assignment to a specific authenticated person is a separate,
explicit decision by someone authorized to assign it. Assignment is not approval
of the proposal. Re-offering must show the complete exact action and cost terms,
then record that person's explicit decision with original proposal provenance.

Restart recovery needs a durable unresolved ledger and scoped UI visibility.
Before any replay, reconcile whether effects already happened. Distinguish
not-dispatched, explicit rejection, expired-without-decision, approved-not-started,
execution-started, completed-with-receipt, and outcome-unknown. Outcome-unknown is
not retryable merely because a request timed out or a process restarted.

## Effect approval binding and final consumption

Bind to issuer/audience, principal, conversation, original request/proposal,
exact normalized tool and full canonical args digest, recipients/destination,
amount/currency when known, limits, expiry and unique invocation ID. Canonical
serialization must recursively define object ordering, arrays, null/undefined,
number representation and unsupported values. Do not substitute a display
summary, truncated body or destination-only digest for the exact action.

Decision and consumption must be durable and atomic. Concurrent identical
requests get at most one execution permission. Consuming before provider submit
can leave outcome unknown; preserve idempotency key and provider receipt, and
never issue replacement authority without reconciliation. Sending succeeded but
recording failed is not failed-not-sent. Revocation must be checked at the final
boundary. Provider errors must not trigger another provider/identity by fallback.

## Acceptance evidence still required

1. Two independent protected principals: executor cannot read/write issuer
   key, code, configuration, decisions, owner assignments or human sessions.
2. Real authenticated channel messages survive Memory and Redis paths with
   verified principal/conversation, while forged payloads and unsigned events
   never acquire authority; replay after restart is refused.
3. Cross-user list/decision tests, expired/revoked envelopes, altered content,
   altered args/recipients/amount and key-rotation mismatch are denied.
4. Actual durable queue restart and abrupt process termination preserve
   proposal and receipt states. Two concurrent final consumers get one permit.
5. Owner assignment and explicit approval are independently visible decisions;
   a missing owner remains unresolved, not rejected or auto-approved.
6. UI loss of connectivity and false decision results remain visible; no global
   disclosure of private pending existence or content.
7. Provider delivery and cost verification require separate scoped authority.
   Local contract tests cannot certify provider delivery, prod boot or wallet
   behavior. No provider/model call is part of this preparation.

## Next decision boundary

Choose an explicitly authorized isolated validation environment and credential/
egress topology before wiring this design into execution. Until then, complete
local source corrections and review, keep the preparatory design disconnected,
and report owner/issuer/Redis autonomy as open rather than claiming protection.
