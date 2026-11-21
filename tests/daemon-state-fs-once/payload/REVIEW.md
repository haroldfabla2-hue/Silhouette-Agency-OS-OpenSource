# V7 consolidated inactive package for independent review

HOLD remains. The independently reviewed source delta is consolidated here.
Manifests, inactive workflow and an exact local activation/retirement proposal
are prepared for review only. No remote mutation or activation is authorized. No imports, helper runs, tests, probes, compiler, services or
product execution. The transformation scripts only edit and parse source.

## Exact scope

Only producer/network.INACTIVE.py changes behavior. Bootstrap, launch and
producer change only CLOSED_ERROR_CODES, verified by AST equality ignoring that
assignment. The operations inventory adds four strict JSON read labels. The
other v6 files are not revised. Candidate, FS11, fulltypes, OCI, offline tree,
filter contents/allowlist/ports/routes, technical export v5 and destinations are
unchanged. The nft scripts add an exclusive creation guard, not a filter rule.

## Creation is not inferred from a random reservation

The existing mutation ledger now records four resource-specific creation
attempts: namespace, veth pair, namespace table and host table. Each record links
to the actual mutation entry. It is persisted before invoking the command. A
separate acknowledged flag is set only after command success, with the existing
mutation state also required to be COMMAND_ACKNOWLEDGED. Recovery does not
manufacture any missing attempt, acknowledgement or identity.

- Namespace: acquire device plus inode after acknowledged creation. Every
  namespace-dependent identity read and cleanup requires both to match.
  Symlink targets are refused with a no-follow stat.
- Veth: acquire both endpoint ifindices after acknowledged creation, require
  both links to report kind veth and reciprocal link_index/ifindex, and record
  peer location. Initially both are on the host. After move, the same indices
  must be reciprocal across host and the acquired namespace, with the peer
  observed only inside that namespace. That acquired moved identity is saved.
  No cleanup fallback adopts the currently observed pair.
- Tables: both nft input files begin with exclusive create table, followed by
  the existing table definition in the same nft -f input. A colliding existing
  table is not accepted as the fixture's successful creation. Acquire each
  table's kernel handle immediately after acknowledged creation and persist it
  before the next setup stage. Snapshot checks now compare, not acquire,
  namespace and host table handles. Tables are deleted by the acquired handle,
  not by the reserved table name.

The authoritatively fetched nft manual documents create vs add and table-handle
removal; the kernel specification documents the delete handle attribute:
https://www.netfilter.org/projects/nftables/manpage.html
https://docs.kernel.org/netlink/specs/nftables.html
No installed-version capability is claimed. Unsupported create/handle/schema
behavior is a closed failure, not a fallback to name-based adoption/deletion.
The nft CLI transaction and real link JSON remain unexecuted and untested here.

## Cleanup dependencies, not independent destructive best efforts

Cleanup first reads and validates the entire observed resource set, before any
network deletion. An existing unattempted resource, an uncertain creation with
no acquired identity, a changed handle or endpoint, an incomplete pair, a
foreign namespace table/link, malformed output or read error causes UNKNOWN
and retention. It does not proceed to delete the namespace and thereby remove
an unproven pair or table indirectly.

Only after that precheck may cleanup delete host table by acquired handle,
the checked veth through its host endpoint, the namespace table by acquired
handle, then the acquired namespace. The pair is checked again immediately
before deleting its host endpoint. Before deleting the namespace, both selected
veth names must be absent, namespace nft tables must be empty and only lo at
ifindex1 may remain. Any failure stops later dependent removals and retains
UNKNOWN. The final absence checks remain mandatory before REMOVAL_VERIFIED.
No host peer deletion by name remains. No namespace/table identity is acquired
or overwritten during cleanup. No prefix sweep or retry was added.

Source-path review, not executed tests:

| Observed state | Required result |
| --- | --- |
| No own attempt, same-name object appears after preflight | Acknowledgement gate fails before any deletion; UNKNOWN |
| Attempt started, command failed/timed out, object exists | Missing acknowledgement and identity fail closed; UNKNOWN |
| Acknowledged create, identity acquisition/persistence interrupted | Missing/mismatched saved identity fails closed; UNKNOWN |
| Pair created, move interrupted with actual location differing from saved | Pair comparison fails; UNKNOWN, namespace retained |
| Table replaced or peer replaced/half missing | Handle or reciprocal saved-pair mismatch; UNKNOWN |
| Namespace identity changed | No dependent namespace operations or namespace deletion |
| All targeted objects absent | Absence can be verified without adopting or deleting anything |
| Successful captured set remains identical | Guarded removals then final absence checks; no success claimed until verified |

## Descriptor and bounds

The /run descriptor starts as None. Its acquisition, diagnostic-bound guard and
initial persistence now all occur inside the try/finally. The finally closes it
whenever acquired, even if persistence or error reporting fails. The original
anchored namespace semantics otherwise remain v6, including exact-empty only
with stable double ENOENT. New snapshot link reads receive the existing deadline.
The existing 64-read bound is unchanged. A bound failure remains UNKNOWN.

## Limits that this delta does not hide

A command acknowledgement followed by a userspace identity read is not an
atomic creation receipt. A privileged external actor can replace an object
between those operations. The veth and namespace delete CLI paths also select
by name after the last identity comparison, so a replacement in that final
interval cannot be excluded by this design. Handle-based table deletion narrows
that problem for tables, but does not make all other CLI calls atomic.

This delta fixes the concrete reservation-only and uncertain-attempt deletion
paths. It does not claim protection against every concurrent privileged host
mutation or a new kernel-held ownership mechanism. If the required guarantee
includes that last interval, this CLI-only delta is insufficient and must stay
on HOLD for a separately scoped design decision, not a stronger claim or an
unreviewed new framework. A conservative mismatch may also retain resources
that were actually ours. Actual disposable-VM teardown is still the fallback;
UNKNOWN is never advertised as removal proof.

## Verification and next step

The separate delta STATIC-CHECKS.json records the exact base v6 root, changed network hash, added
guard codes and source-only checks. AST parse of all19 Python files, catalog-only
AST equivalence of the three support entrypoints and an exact unified diff were
performed. This is not behavioral validation. No fulltypes or FS11 result exists.
Independent review precedes any repinning, activation proposal or next effect.

## Mandatory operational scope

Any later authorized use is exclusively a fresh dedicated disposable VM with
no competing privileged writers. Never use this fixture on a shared host. One
attempt only. UNKNOWN retains resources for actual VM teardown, without retry
or VM reuse. Scope remains full repository typecheck and eleven real FS helper
tests, not daemon/application integration. Types and FS11 are still pending.
No merge, deploy, Tamara, costs or new permissions. This package is not consent
to publish, execute, change network policy or create a second attempt.
