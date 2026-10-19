// recall@10 of USearch HNSW vs exact brute-force oracle, seeded and reproducible.
// Usage: node recall-ann.mjs [N] [QUERIES]
import { Index } from "usearch";
import * as os from "node:os";

const N = parseInt(process.argv[2] || "100000", 10);
const QUERIES = parseInt(process.argv[3] || "50", 10);
const DIM = 768, K = 10;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
function randVec(buf) {
  let n = 0;
  for (let i = 0; i < DIM; i++) { const x = rng() - 0.5; buf[i] = x; n += x * x; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) buf[i] /= n;
  return buf;
}

const freeMB = os.freemem() / 1e6;
console.error(`free RAM before start: ${freeMB.toFixed(0)}MB`);
if (freeMB < 1500) { console.error("ABORT: <1.5GB free, refusing to risk prod"); process.exit(2); }

const t0 = performance.now();
const data = new Float32Array(N * DIM);
const idx = new Index({ dimensions: DIM, metric: "cos", connectivity: 16, expansion_add: 128, expansion_search: parseInt(process.argv[4] || "64", 10) });
const buf = new Float32Array(DIM);
for (let i = 0; i < N; i++) {
  randVec(buf);
  data.set(buf, i * DIM);
  idx.add(BigInt(i), buf);
  if (i && i % 50000 === 0) console.error(`  ...${i} rss=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB free=${(os.freemem() / 1e6).toFixed(0)}MB`);
}
const buildMs = performance.now() - t0;
console.error(`build done in ${(buildMs / 60000).toFixed(1)}min, running ${QUERIES} queries`);

function exactTopK(q) {
  const scores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    const off = i * DIM;
    for (let j = 0; j < DIM; j++) s += data[off + j] * q[j];
    scores[i] = s;
  }
  const top = [];
  for (let i = 0; i < N; i++) {
    if (top.length < K || scores[i] > top[top.length - 1].s) {
      top.push({ i, s: scores[i] });
      top.sort((a, b) => b.s - a.s);
      if (top.length > K) top.pop();
    }
  }
  return top.map(t => String(t.i));
}

let sum = 0, min = 1, searchMs = 0;
for (let qi = 0; qi < QUERIES; qi++) {
  const q = randVec(new Float32Array(DIM));
  const s0 = performance.now();
  const ann = idx.search(q, K);
  searchMs += performance.now() - s0;
  const annKeys = new Set(Array.from(ann.keys).map(String));
  const oracle = exactTopK(q);
  const hit = oracle.filter(k => annKeys.has(k)).length / K;
  sum += hit; if (hit < min) min = hit;
  if (qi % 10 === 9) console.error(`  q${qi + 1}/${QUERIES} recall@10 avg so far=${(sum / (qi + 1)).toFixed(3)} free=${(os.freemem() / 1e6).toFixed(0)}MB`);
}
console.log(JSON.stringify({
  N, DIM, K, QUERIES, seed: 42,
  buildMin: +(buildMs / 60000).toFixed(1),
  annSearchAvgMs: +(searchMs / QUERIES).toFixed(2),
  recallAt10Avg: +(sum / QUERIES).toFixed(4),
  recallAt10Min: +min.toFixed(4),
  rssEndMB: Math.round(process.memoryUsage().rss / 1e6),
}));
