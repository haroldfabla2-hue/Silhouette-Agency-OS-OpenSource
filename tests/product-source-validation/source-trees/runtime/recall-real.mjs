// recall@10 on REAL prod memory embeddings (read-only copy) vs exact oracle.
import { connect } from "@lancedb/lancedb";
import { Index } from "usearch";

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const K = 10, QUERIES = 50;
const db = await connect("/tmp/lancedb-recall-copy");
const vtable = (await db.tableNames()).find(t => t.startsWith("memory_vectors_"));
const tbl = await db.openTable(vtable);
const rows = await tbl.query().select(["id", "vector"]).toArray();
const vecs = rows.map(r => Array.from(r.vector));
const DIM = vecs[0].length;
const N = vecs.length;
console.error(`table=${vtable} N=${N} DIM=${DIM}`);

function exactTopK(q) {
  const top = [];
  for (let i = 0; i < N; i++) {
    let s = 0; const v = vecs[i];
    for (let j = 0; j < DIM; j++) s += v[j] * q[j];
    if (top.length < K || s > top[top.length - 1].s) { top.push({ i, s }); top.sort((a, b) => b.s - a.s); if (top.length > K) top.pop(); }
  }
  return top.map(t => String(t.i));
}

const rng = mulberry32(7);
const qIdx = new Set(); while (qIdx.size < QUERIES) qIdx.add(Math.floor(rng() * N));
const queries = [...qIdx].map(i => vecs[i]);
const oracles = queries.map(exactTopK);

for (const exp of [64, 256]) {
  const t0 = performance.now();
  const idx = new Index({ dimensions: DIM, metric: "cos", connectivity: 16, expansion_add: 128, expansion_search: exp });
  for (let i = 0; i < N; i++) idx.add(BigInt(i), vecs[i]);
  const buildMs = performance.now() - t0;
  let sum = 0, min = 1, searchMs = 0;
  for (let qi = 0; qi < QUERIES; qi++) {
    const s0 = performance.now();
    const ann = idx.search(queries[qi], K);
    searchMs += performance.now() - s0;
    const annKeys = new Set(Array.from(ann.keys).map(String));
    const hit = oracles[qi].filter(k => annKeys.has(k)).length / K;
    sum += hit; if (hit < min) min = hit;
  }
  console.log(JSON.stringify({ source: "prod-real-embeddings", table: vtable, N, DIM, K, QUERIES, expansion_search: exp, buildS: +(buildMs / 1000).toFixed(1), annSearchAvgMs: +(searchMs / QUERIES).toFixed(2), recallAt10Avg: +(sum / QUERIES).toFixed(4), recallAt10Min: +min.toFixed(4) }));
}
