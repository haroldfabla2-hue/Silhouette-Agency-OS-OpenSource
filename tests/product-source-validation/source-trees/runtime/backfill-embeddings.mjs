// Backfill gemini-embedding-001 (768d) vectors for EMBEDDING_PENDING memories.
// Authorized scope: free tier only, zero charges, important first, paced, abort on 429.
// Usage: node backfill-embeddings.mjs [--limit N] [--batch N] [--pace-ms N] [--dry-run]
import { connect } from "@lancedb/lancedb";
import * as fs from "node:fs";
import * as os from "node:os";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? parseInt(args[i + 1], 10) : d; };
const LIMIT = opt("limit", 50), BATCH = opt("batch", 100), PACE = opt("pace-ms", 8000);
const DRY = args.includes("--dry-run");
const DB = "/opt/silhouette/db/silhouette.lancedb";
const VECTORS_TABLE = "memory_vectors_616eeaaa22c44c9d9a07b7f3";
const MODEL = "gemini-embedding-001", DIMS = 768;
const LOG = "/opt/deploy-logs/backfill.log";
const KEY = (fs.readFileSync("/opt/silhouette/.env", "utf8").match(/^GEMINI_API_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
if (!KEY) { console.error("no GEMINI_API_KEY"); process.exit(2); }
if (os.freemem() / 1e6 < 1500) { console.error("ABORT: <1.5GB free RAM"); process.exit(2); }

const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); fs.appendFileSync(LOG, line + "\n"); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const db = await connect(DB);
const records = await db.openTable("memory_records_v2");
const vectors = await db.openTable(VECTORS_TABLE);
const existing = new Set((await vectors.query().select(["id"]).toArray()).map(r => r.id));

const pendRows = await records.query().where("embedding_state = 'EMBEDDING_PENDING'").toArray();
const tierRank = { DEEP: 0, MEDIUM: 1, WORKING: 2, SENSORY: 3 };
const pending = pendRows
  .filter(r => !existing.has(r.id))
  .map(r => ({ id: r.id, ownerId: r.ownerId || "system", json: r.json_data, tier: r.tier, importance: r.importance ?? 0 }))
  .sort((a, b) => (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9) || b.importance - a.importance)
  .slice(0, LIMIT);
log(`pending total=${pendRows.length} already-projected=${existing.size} selected=${pending.length} limit=${LIMIT} dry=${DRY}`);
if (DRY || pending.length === 0) process.exit(0);

let done = 0, requests = 0;
for (let off = 0; off < pending.length; off += BATCH) {
  const chunk = pending.slice(off, off + BATCH);
  if (requests > 0) await sleep(PACE);
  const body = { requests: chunk.map(m => ({ model: `models/${MODEL}`, content: { parts: [{ text: (JSON.parse(m.json).content || "").slice(0, 8000) }] }, outputDimensionality: DIMS })) };
  // 429 can be per-minute (RPM, transient; the post-restart organism burst
  // exhausted it at 15:03Z on 2026-10-18 while the daily bucket was fine) or
  // per-day (RPD, hard stop). Retry once after 65s; a second 429 = daily stop.
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    requests++;
    if (res.status === 429 && attempt === 0) {
      log(`429 RPM? waiting 65s and retrying once (${done} done, ${requests} requests so far)`);
      await sleep(65000);
      continue;
    }
    break;
  }
  if (res.status === 429) { log(`QUOTA 429 (daily) after ${done} memories, ${requests} requests - stopping (resume tomorrow)`); process.exit(3); }
  if (!res.ok) { log(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)} - aborting`); process.exit(1); }
  const data = await res.json();
  const embs = data.embeddings || [];
  if (embs.length !== chunk.length) { log(`batch size mismatch ${embs.length}!=${chunk.length} - aborting`); process.exit(1); }
  for (let i = 0; i < chunk.length; i++) {
    const m = chunk[i];
    const vector = embs[i].values;
    if (!Array.isArray(vector) || vector.length !== DIMS) { log(`bad vector for ${m.id} (len ${vector?.length}) - skipping`); continue; }
    const record = { id: m.id, vector, ownerId: m.ownerId, json_data: m.json };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await vectors.mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([record]);
        await records.update({ where: `id = '${m.id.replace(/'/g, "''")}'`, values: { embedding_state: "READY" } });
        break;
      } catch (e) {
        if (attempt === 3) { log(`write failed for ${m.id}: ${e.message} - continuing`); }
        else await sleep(500 * attempt);
      }
    }
    done++;
  }
  log(`batch ${requests}: +${chunk.length} (done ${done}/${pending.length}) free=${(os.freemem() / 1e6).toFixed(0)}MB`);
}
log(`RUN COMPLETE: ${done} memories embedded+projected, ${requests} batch requests`);
