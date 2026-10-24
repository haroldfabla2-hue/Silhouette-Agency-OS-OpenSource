# Stage 3 bounded cut

The code/test tree after the two normal freshness reverts is identical to
c10b0ce. This document is the only additional change to that tree.

Operational condition: one writer/handle per database directory. This is
an integration requirement, NOT a verified description of production.
Confirm the condition against owner-controlled deployment sources before
integration or deployment. No deployment is authorized by this document.

The memory_records_v2 first-create fix covers same-module concurrent
instances and specific already-exists recovery. Tests show durable rows
and reopening via a new instance, NOT general coherent multiwriter reads.
The original winner handle can miss a later writer's commit until reopen.
Generic createTable and universal_knowledge creation are outside this fix.

The separate hardening/memory-cross-instance-freshness branch preserves
e73768c/f607de9. It is unapproved. Its epoch mechanism covers only
getNodeById in one module, not search/getNodesByIds/getAllNodes or other
processes. Failed CI runs 40075071560 (vector restart waitFor timeout) and
40075423734 (unexpected embedding call count) remain FAILED, root causes
OPEN. Self-reopen was observed but was not proven to cause either failure.
PR205 composition 2be8589 is evidence for the earlier c10b0ce cut only.
