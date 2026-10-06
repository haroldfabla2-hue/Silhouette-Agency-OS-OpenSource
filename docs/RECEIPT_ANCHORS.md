# Receipt chain external anchors

The signed receipt chain (see `PROCEDURE_APPROVAL_LEDGER.md`) is hash-linked and
Ed25519-signed, but that alone cannot detect deletion of the newest entries: a
truncated chain still verifies. Anchoring copies the chain head (`seq`,
`entryHash`, `keyId`) into a SEPARATE git repository, so an outside record
exists that the database cannot rewrite retroactively without detection.

## What is implemented

`services/procedureReceiptAnchor.ts` only produces and verifies anchor content.
Nothing here writes files, runs git, pushes, or talks to a network.

- `ProcedureApprovalLedger.chainHead()`: operator-level read of the newest
  signed receipt's `seq`, `entryHash` and `keyId`. It exposes no payload and no
  receipt body.
- `buildAnchor(head)`: canonical anchor bytes, a pure function of the head.
- `parseAnchor(content)`: strict closed decoder. Rejects unknown or missing
  fields, wrong types, bad hashes and any non-canonical byte representation
  (including reordered keys, extra whitespace and trailing newlines).
- `verifyAnchor(head, content)`: true only when the stored anchor names exactly
  this head.
- `anchorPath(seq)`: `anchors/seq-<seq>.json`. One file per anchored head,
  never overwritten.
- `anchorRepoUrlFromEnv()`: the ONLY source of the anchor repository location
  is `SILHOUETTE_RECEIPT_ANCHOR_REPO_URL`. There is no default. It must be an
  `https://...git` or `git@...:....git` remote; anything else throws.

## Anchor format (schema v1)

```json
{"v":1,"kind":"RECEIPT-ANCHOR","seq":137,"entryHash":"<64 hex>","keyId":"<signer key id>"}
```

Exactly these five keys in this order, compact JSON, no trailing newline.
`entryHash` is the SHA-256 of the receipt payload, exactly as stored in the
`procedure_receipts` table, so the anchor adds no new secret material: it is a
hash plus a key id, not receipt contents.

## Repository layout and operator flow

The anchor repository is a small standalone git repository (for example
`ledger-anchors`) that contains nothing but anchors and this description.
One commit and one tag per anchored head:

```sh
export SILHOUETTE_RECEIPT_ANCHOR_REPO_URL=git@github.com:<owner>/ledger-anchors.git
# produce anchors/seq-<N>.json from buildAnchor(chainHead()), then:
git add anchors/seq-<N>.json
git commit -m "Anchor receipt chain head seq <N>"
git tag anchor-seq-<N>
git push origin main --tags
```

To audit later: recompute `chainHead()` from the live database, read the newest
`anchors/seq-*.json` from the repository, and require
`verifyAnchor(head, content)`. A mismatch means the database head moved without
an anchor (truncation, or anchors not being published), which is exactly the
case this mechanism exists to surface.

## Boundary: single owner, single ledger

This design assumes ONE owner operating ONE ledger database anchoring into ONE
repository. Multi-tenant use (several owners or several independent ledger
databases sharing one anchor repository) is explicitly out of scope: seq
numbers and the single head file layout would collide, and per-tenant paths,
per-tenant signer sets and a fork/merge policy would all be required. That is
future work, not hidden behind this module.

## Limits, stated plainly

- Anchoring detects tail truncation only if the operator anchors BEFORE the
  deletion and actually compares during audit. It is a detective control, not
  prevention.
- The anchor binds `seq` + `entryHash` + `keyId`. It does not re-sign anything;
  the receipt signatures stay the cryptographic root. An attacker who holds the
  signing key can extend the chain AND publish matching anchors.
- Integrity and availability of the anchor history depend on the git host.
  Force-push or repository deletion by someone with host access erases anchors;
  protect the repository (no force-push, restricted access) accordingly.
- `chainHead()` is an operator-level read. Callers that must not see chain
  metadata should not receive it; it carries no receipt contents.
- No automated publishing, scheduling or retry is included. The git commit, tag
  and push are the operator's explicit action.
