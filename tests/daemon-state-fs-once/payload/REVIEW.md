# V10 consolidated inactive veth identity package, review only

Consolidated manifests/pins and exact local activation/retirement proposal
are prepared for independent review. No publication, helper import, CLI
experiment, test, probe, service or retry. V9 is terminal
and retired. Types and FS11 remain pending. This package does not authorize activation.

## Evidence now available, with version boundaries

V9 run44859673472 recorded primary NET_VETH_PAIR_SCHEMA independently of
cleanup NET_CLEANUP_UNKNOWN. Exact link stdout was retained and byte/hash
verified. Both veth endpoints were on the host, with unique ifindices5/6,
info_kind veth, distinct MACs and reciprocal peer names in the JSON field link.
Neither row contained link_index or link_netnsid. The selected namespace read
contained only lo, consistent with failure before move. No delete followed.

This is the demonstrated V9 failure. V7's own original rows and initial guard
remain missing and unrecoverable, not retroactively supplied by V9.

https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource/actions/runs/44859673472
https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource/actions/runs/44859673472/artifacts/14689421953

Primary iproute2 source print_name_and_link explains the two formats:
- IFLA_LINK without IFLA_LINK_NETNSID resolves the referenced index through
  ll_index_to_name and emits JSON link as that name.
- With IFLA_LINK_NETNSID it emits numeric JSON link_index. ipaddress also emits
  link_netnsid, which is a namespace-local mapping ID, not a global identity.
This branch is present in both inspected source versions.

https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/lib/utils.c
https://raw.githubusercontent.com/iproute2/iproute2/v6.8.0/lib/utils.c
https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/ip/ipaddress.c
https://raw.githubusercontent.com/iproute2/iproute2/v6.8.0/ip/ipaddress.c

The netns source implements list-id via RTM_GETNSID dump, and print_nsid emits
nsid and resolves name through named namespace file descriptors. It provides
an observed mapping from host-local link_netnsid to the selected named namespace.
No netns set/alias creation or assigned-ID mutation is added by this delta.

https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/ip/ipnetns.c

These are inspected upstream source semantics, not proof that an unexecuted
future runner will return every required field. A missing mapping/schema is a
closed blocker. Post-move V10 behavior has NOT been executed or validated.

## Before movement: prove the local pair, do not invent numeric references

veth_identity still requires exactly one selected host and peer row and rejects
an extra selected peer in the acquired namespace. It now checks a bounded list
of dicts, veth kind, positive integer ifindex and syntactically valid MAC for
each endpoint. The indices and MACs must be distinct.

When both rows are in the host namespace, each link must equal the other row's
actual ifname. link_index and link_netnsid must be absent, so contradictory or
remote-format data cannot enter the local branch. Both name references resolve
only against those two unique observed rows and their actual indices. No
index is synthesized from a suffix or guessed from a reserved name. This is
kernel IFLA_LINK output rendered through the owning namespace's link-name map,
not arbitrary textual resemblance.

The acquired identity now includes both ifindices, both MACs, host network
namespace device/inode and peer location. Host namespace identity is checked
before/after reads; the already acquired target namespace device/inode is
checked around its reads too. MACs reinforce continuity, they are not a stand-
alone ownership grant or a claim that MACs cannot be changed by a privileged actor.

## Movement: preserve provenance across namespace-local index spaces

The existing single move mutation now records resource vethMove in the existing
attempt/acknowledgement ledger. No extra move, retry or kernel mutation is added.
A moved pair requires that exact mutation's recorded acknowledgement. A timeout
or interrupted move cannot be promoted to an acknowledged move from a name.

After the peer is observed inside the acquired namespace:
- Both endpoints must keep the source pair's acquired indices, MACs and host
  namespace identity. Missing initial identity is never filled from current rows.
- Both must be veth with numeric reciprocal link_index references and numeric
  nonnegative link_netnsid. The link name field must be absent to reject mixed
  or contradictory reference schemas. Each link_index must equal the actual
  other endpoint ifindex read in its own known namespace.
- A strict, exact-stdout-captured ip -j netns list-id read must map the host
  endpoint's remote nsid uniquely to the selected namespace name. Both nsid
  lookup and name lookup must produce the same sole nondeleted record. Target
  namespace device/inode is rechecked, so name alone does not establish it.
- The peer's link_netnsid is local to the peer namespace. It is NOT compared
  numerically to the host's ID and is NOT treated as a global namespace number.
  Reverse relation is established through the carried original pair identity,
  reciprocal numeric links, observed peer namespace and acknowledged move, not
  an invented equality between two namespace-local nsid values.

The existing setup then demands that the returned identity is identical to the
source pair except peerLocation=NAMESPACE before saving the moved identity.
Any reindexing during move is a conservative blocker, not silently adopted,
even if it could be legitimate. The fresh namespace should not be assumed to
make a collision impossible. Exact observed continuity must pass.

## Cleanup, evidence and limits

Cleanup's code and deletion gates are byte/AST unchanged. It consumes the same
veth_identity method, so both endpoint identities and namespace relationship
must still match the acquired saved pair before the one host-endpoint delete.
No peer-by-name fallback or resource adoption is added. Unknown/incomplete/
contradictory references or mapping errors retain UNKNOWN and dependent
namespace resources. Recovery does not manufacture old/new identity fields.
Old ledgers without the stronger identity fail closed rather than being upgraded.

The new namespace-ID read uses the existing read_json exact stdout recording,
closed operation label, deadline and original byte/hash evidence. No limits
increase:32768B/read,98304B total raw evidence,64reads,262144B ledger export,
12MiB artifact. Additional reads consume existing limits; overflow is a closed
failure/UNKNOWN, not a reason to raise limits or omit oracle evidence. All
primary/secondary error preservation and v9 export paths remain unchanged.

This is still a CLI snapshot design on a fresh dedicated disposable VM without
privileged competing writers. It does NOT eliminate privileged replacement
between reads, after acknowledgement or before a name-based delete. Source
pair continuity and namespace mapping are required, not just accidental equal
indices from unrelated namespace spaces. It must never be used to justify
ownership on a shared host or against an active privileged adversary.

## Static verification only

Only network.INACTIVE.py behavior and the new operation inventory change.
Bootstrap/launcher/producer/offline controller change only the diagnostic closed
catalog to keep failure classification aligned, verified by AST equality after
removing that one assignment. Network read_json, record_failure, namespace
preflight, creation acknowledgement, snapshot/probe and cleanup functions are
unchanged. Setup only adds resource=vethMove to the already existing mutation.
Candidate, eleven FS tests, compiler, OCI, nft rules, gates, cgroup observer,
resource profiles, allowlist, export mechanism and all bounds are unchanged.

Package contains source overlay, exact v9-v10 diff, static checks and hashes.
No runtime tests, simulations or probes were used as correctness evidence.
Independent review and separate decision precede any consolidation or effect.
One eventual attempt only, no automatic retry/reuse/widening/network/sysctl/
permission changes, no Tamara/main/merge/deploy/spend. UNKNOWN retains until
actual VM teardown. No functional success or demonstrated post-move fix yet.

## Closed-code synchronization

The independently identified missing remote source continuity code is included.
CLOSED-CODE-COVERAGE.json derives literal guard/RuntimeError codes across all19
Python sources plus every NET code literal. All five local diagnostic catalogs
and the code inventory are synchronized; no used literal in that set is missing.
Unknown arbitrary exception text remains classified unknown, never exported raw.
Post-move output remains unobserved, no compatibility or functional PASS claimed.
