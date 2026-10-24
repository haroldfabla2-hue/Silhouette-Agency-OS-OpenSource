# Etapa 4: offline topology measurement, not a trained GNN

## Verified code baseline

At main 80730c3, `reasoning_engine/main.py:predict_links` counts common
neighbors in Neo4j. Its confidence formula is `min(0.5 + neighbors*0.1, 0.99)`.
This is a heuristic score, not a calibrated probability or trained GNN.
The query uses directed RELATED_TO motifs. The new offline baseline below
uses an explicitly different undirected projection; it does not reproduce
that endpoint or establish its production quality.

This branch changes no discovery scheduling, live provider calls, graph
writes, deployment, autonomy, memory retention or architecture. It contains
only measurement code, tests and this explanation. Generic GNN deployment,
training and a runtime fallback remain separate decisions. Importing this
measurement code does not import runtime application services.

## Run only against an explicit offline input

```
npx tsx scripts/measure_biomimetic_topology.ts --json /path/to/edges.json
npx tsx scripts/measure_biomimetic_topology.ts --sqlite /path/to/local-copy.sqlite
```

JSON is an array of `{ "source": "node-id", "target": "node-id" }` objects.
SQLite mode reads `graph_edges` and, if present, decision counts from
`discovery_journal`. It opens an existing file read-only with query_only ON;
it never creates or migrates tables. Use a consistent local backup, not the
running production DB. There is no implicit default DB path. The program
makes no network requests and does not need credentials or provider quota.
Do not paste graph exports into a public PR. Output contains aggregate
counts and scores, not node IDs, text or journal feedback. Aggregate
statistics from private data still require review before publication.

## Method and limits

- Collapse edge direction/type and duplicates; remove self loops. This loses
  relation semantics, so do not compare it as if it were the directed runtime query.
- Deterministic seed-based SHA256 edge ordering, 20% held out (minimum one,
  with at least one train edge). Known-node universe is transductive: nodes
  that lose all training edges remain in the denominator and are counted cold.
- Build all neighbor sets and degrees from TRAIN edges only. Compute common
  neighbors, Jaccard and Adamic-Adar on every non-training pair.
- Rank by score, break ties by canonical pair key. Include zero-score ties
  but report them explicitly; recall can be high merely because K covers
  almost the full candidate set. Default K=10, no silent negative sampling.
- Observed-edge reconstruction is NOT semantic truth, future-link accuracy,
  discovery usefulness, calibrated confidence or causal impact. Unobserved
  pairs are UNKNOWN, not verified negatives. The observedEdgeFractionAtK
  field is intentionally not named precision. No AUC is fabricated.
- Random holdout is not temporal validation. Graph edges have last_updated,
  not a verified creation time; future experiments need provenance-aware
  splits before claiming future prediction quality.
- At most 100000 input rows and 100000 total unordered node pairs. Larger
  inputs fail explicitly before quadratic candidate allocation. Large-scale
  sampling/streaming is not implemented. This is a small-graph audit tool.
- Empty/single-edge graphs return insufficient-data with null metrics.
  Missing/not-supplied journal = null; present empty journal = []. Journal
  decisions are not independent truth and are never treated as accuracy.

## Evidence in this branch

Unit tests check hand-calculated scores, deterministic splits, duplicate
handling, empty/cold graphs, holdout topology removal and candidate budgets.
CLI tests use temporary SQLite/JSON fixtures: read-only byte preservation,
empty journal, missing path without database creation and invalid input.
These are declared synthetic fixtures, not production measurement results.
No real graph was read for this branch; no production baseline is claimed.

## Recommendation

Use this tool first on an authorized, consistent local graph snapshot and
inspect data sufficiency and cold-edge counts. If useful, add a domain-aware
and temporal evaluation before choosing a runtime heuristic. Do not deploy
or rename this measurement as a GNN. Training, infrastructure and a change
to the live discovery loop require their own review and authority.
