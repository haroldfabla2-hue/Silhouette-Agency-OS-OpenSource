/**
 * Etapa 3 - OS-process restart proof, phase 2 (VERIFY), real OS process.
 *
 * Runs in a NEW OS process after seed.ts exited (real process restart, not
 * a module restart). Boots the memory stack fresh against the same on-disk
 * storage and asserts the seeded nodes survive with id/content/tier/tags
 * intact, and that DEEP vectors serve retrieval with the REAL local
 * embedding model (LOCAL_EMBEDDING_IDENTITY, 384 dims) without any
 * re-embedding of stored memories.
 *
 * No mocks, no substitutes. Same weights requirement and exit codes as
 * seed.ts: 0 = PASS receipt (last stdout line, JSON), 1 = FAIL, 3 = BLOCKED.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Anclaje al repo: los servicios resuelven almacenamiento relativo al cwd
// (db/, data/). El script se auto-ancla a la raiz del repo sin importar el
// cwd de lanzamiento (en jaula el chroot arranca en /).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(REPO_ROOT);

const RUN = process.env.MEMORY_OS_RESTART_RUN;
if (!RUN) { console.error('MEMORY_OS_RESTART_RUN missing'); process.exit(1); }

const MODEL_DIR = path.join(REPO_ROOT, 'models', 'Xenova', 'all-MiniLM-L6-v2');
// Los 5 archivos del modelo que el staging registra (lote6-P1-fs.txt);
// alineado con el doc (revisor lote 7, hallazgo 1).
const REQUIRED = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt', path.join('onnx', 'model_quantized.onnx')];
const missing = REQUIRED.filter(f => !fs.existsSync(path.join(MODEL_DIR, f)));
if (missing.length) {
    console.log('OS_RESTART_RECEIPT ' + JSON.stringify({ status: 'BLOCKED', reason: `local model weights not staged at ./models/Xenova/all-MiniLM-L6-v2 (missing: ${missing.join(', ')})` }));
    process.exit(3);
}

function fail(msg: string): never { console.log('OS_RESTART_RECEIPT ' + JSON.stringify({ status: 'FAIL', reason: msg })); process.exit(1); }

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function waitFor(cond: () => Promise<boolean>, ms = 60000, step = 250): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < ms) { if (await cond()) return; await new Promise(r => setTimeout(r, step)); }
    throw new Error('waitFor timeout');
}

async function main() {
    const { MemoryTier } = await import('../../types');
    const { continuum } = await import('../../services/continuumMemory') as any;
    const { lancedbService } = await import('../../services/lancedbService');
    const { localEmbeddingService } = await import('../../services/localEmbeddingService');
    const { LOCAL_EMBEDDING_IDENTITY } = await import('../../services/embeddingIdentity');

    const TARGET = `${RUN} principios de termodinamica entropia y energia libre`;
    const DECOY = `${RUN} instrucciones para armar una bicicleta de montana`;

    // ---- Tier recovery after the real process restart ----
    const findIn = (nodes: any, s: string) => (nodes || []).find((n: any) => n.content === s);
    await waitFor(async () => {
        try {
            const all = await continuum.getAllNodes();
            return !!(findIn(all[MemoryTier.MEDIUM], `${RUN} receta de sopa de pollo con verduras y papa`)
                && findIn(all[MemoryTier.LONG], `${RUN} historial de mantenimiento del servidor de produccion`)
                && findIn(all[MemoryTier.DEEP], TARGET)
                && findIn(continuum.getVolatileState(), `${RUN} agenda semanal del equipo de ventas y sus objetivos`));
        } catch { return false; }
    });
    const all = await continuum.getAllNodes();
    const medium = findIn(all[MemoryTier.MEDIUM], `${RUN} receta de sopa de pollo con verduras y papa`);
    const long = findIn(all[MemoryTier.LONG], `${RUN} historial de mantenimiento del servidor de produccion`);
    const deep = findIn(all[MemoryTier.DEEP], TARGET);
    const working = findIn(continuum.getVolatileState(), `${RUN} agenda semanal del equipo de ventas y sus objetivos`);
    if (medium?.tier !== MemoryTier.MEDIUM) fail('MEDIUM tier placement lost');
    if (long?.tier !== MemoryTier.LONG) fail('LONG tier placement lost');
    if (deep?.tier !== MemoryTier.DEEP) fail('DEEP tier placement lost');
    if (!working) fail('WORKING volatile state lost');
    for (const n of [medium, long, deep, working]) {
        if (typeof n.id !== 'string' || !n.tags?.includes('OS_RESTART_TEST')) fail('node id/tags not intact');
    }

    // ---- Real-embedding vector persistence + identity binding ----
    const targetVec = await localEmbeddingService.getEmbedding(TARGET);
    if (!targetVec) fail('local embedding model returned null (not staged or init failed)');
    if (targetVec.length !== LOCAL_EMBEDDING_IDENTITY.dimension) fail(`dimension mismatch: ${targetVec.length} != ${LOCAL_EMBEDDING_IDENTITY.dimension}`);

    await waitFor(async () => {
        try {
            const hits = await lancedbService.search(targetVec, 5, undefined, LOCAL_EMBEDDING_IDENTITY, { withScores: true });
            return hits[0]?.content === TARGET;
        } catch { return false; }
    });
    const hits = await lancedbService.search(targetVec, 5, undefined, LOCAL_EMBEDDING_IDENTITY, { withScores: true });
    if (hits[0]?.content !== TARGET) fail(`target not top-1 after restart (got: ${hits[0]?.content ?? 'none'})`);
    if (!(hits[0]?.similarity > 0.9999)) fail(`self-similarity ${hits[0]?.similarity} <= 0.9999`);
    const decoyVec = await localEmbeddingService.getEmbedding(DECOY);
    if (!decoyVec) fail('decoy embedding failed');
    const decoyHit = hits.find((h: any) => h.content === DECOY);
    if (!decoyHit) fail('decoy not retrievable');
    const expected = cosine(targetVec, decoyVec);
    if (Math.abs(decoyHit.similarity - expected) > 1e-3) fail(`decoy similarity ${decoyHit.similarity} != cosine ${expected}`);

    // Identity binding: an identity that never wrote serves nothing.
    const wrongIdentity = { model: 'Xenova/all-MiniLM-L6-v2', version: 'other', dimension: 384 };
    const wrong = await lancedbService.search(targetVec, 5, undefined, wrongIdentity as any, { withScores: true });
    if (wrong.length !== 0) fail('identity binding broken: foreign identity served rows');

    // No re-embedding of stored DEEP nodes after restart: the two DEEP rows
    // (the only tier embedded inline by design) must not be PENDING.
    const pending = await lancedbService.pendingEmbeddings(500);
    if (pending.some((n: any) => n.content === TARGET || n.content === DECOY)) fail('DEEP nodes still EMBEDDING_PENDING after restart');
    // MEDIUM/LONG stay EMBEDDING_PENDING by design in this hermetic
    // no-provider block (strict backfill refuses the local identity) - the
    // canonical rows serve text retrieval. Assert the designed state openly
    // instead of hiding it.
    if (!pending.some((n: any) => n.content === `${RUN} receta de sopa de pollo con verduras y papa`)) fail('MEDIUM row unexpectedly not PENDING (designed state changed?)');
    if (!pending.some((n: any) => n.content === `${RUN} historial de mantenimiento del servidor de produccion`)) fail('LONG row unexpectedly not PENDING (designed state changed?)');

    // F10: evidencia de rutas reales en el proceso NUEVO (ver seed.ts).
    const rel = (dir: string): string[] => {
        const out: string[] = [];
        const walk = (d: string, p: string) => {
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                if (out.length >= 40) return;
                const rel2 = p ? `${p}/${f.name}` : f.name;
                if (f.isDirectory()) walk(path.join(d, f.name), rel2); else out.push(rel2);
            }
        };
        try { walk(path.join(REPO_ROOT, dir), ''); } catch { /* ausente */ }
        return out;
    };
    console.log('OS_RESTART_RECEIPT ' + JSON.stringify({ status: 'PASS', run: RUN, top1Similarity: hits[0].similarity, dimension: targetVec.length, storage: {
        overrides: {
            SILHOUETTE_LANCEDB_PATH: process.env.SILHOUETTE_LANCEDB_PATH ?? null,
            SILHOUETTE_DB_PATH: process.env.SILHOUETTE_DB_PATH ?? null,
            SILHOUETTE_IDENTITY_DB_PATH: process.env.SILHOUETTE_IDENTITY_DB_PATH ?? null,
            SILHOUETTE_TOOLS_DB_PATH: process.env.SILHOUETTE_TOOLS_DB_PATH ?? null,
        },
        cwd: process.cwd(), tmpdir: process.env.TMPDIR ?? null,
        dbFiles: rel('db'), dataFiles: rel('data'),
    } }));
}

main()
    .then(async () => {
        try {
            const mod: any = await import('../../services/dreamerService');
            mod.dreamer?.stopDreamingLoop?.();
            const { redisClient } = await import('../../services/redisClient');
            await redisClient.disconnect().catch(() => {});
        } catch { /* drain best-effort */ }
        process.exit(0);
    })
    .catch(async (e) => {
        console.error(e);
        // Recibo prefijado SIEMPRE (revisor #5): un error no atrapado sin
        // recibo dejaba al orquestador sin clasificacion.
        console.log('OS_RESTART_RECEIPT ' + JSON.stringify({ status: 'FAILED', reason: String(e?.message ?? e) }));
        try { const { redisClient } = await import('../../services/redisClient'); await redisClient.disconnect().catch(() => {}); } catch {}
        process.exit(1);
    });
