/**
 * Etapa 3 - OS-process restart proof, phase 1 (SEED), real OS process.
 *
 * Real: on-disk storage (SQLite/LanceDB canonical worker DB + volatile
 * snapshot), the real continuum.store public API, and the REAL local
 * embedding model (Xenova/all-MiniLM-L6-v2, 384 dims, identity
 * LOCAL_EMBEDDING_IDENTITY) via the geminiService no-API-key fallback.
 * No mocks, no substitutes, no fixture vectors.
 *
 * Requires the MiniLM weights staged at ./models/Xenova/all-MiniLM-L6-v2/
 * (see docs/verification/memory-etapa3-os-restart-block.md). If they are
 * absent this process exits 3 with a BLOCKED marker - it never substitutes
 * a fake embedding to keep running.
 *
 * Embedding lifecycle contract (verified statically 2026-11-07):
 * - continuum.store() embeds INLINE only for DEEP nodes
 *   (continuumMemory.ts:505-543). WORKING/MEDIUM/LONG rows are persisted
 *   without a vector and are born EMBEDDING_PENDING
 *   (lancedbService.ts:221); they are embedded later by the backfill
 *   governor, which by design (allowFallbackIdentity:false,
 *   geminiService.ts:1217) never substitutes the local identity. So with
 *   no canonical provider those rows stay EMBEDDING_PENDING BY DESIGN.
 * - Therefore this seed only requires the two DEEP nodes (target + decoy)
 *   to leave EMBEDDING_PENDING; requiring the other tiers to be READY
 *   conflates designed behavior with a product defect.
 *
 * Env (set by the orchestrator): MEMORY_OS_RESTART_RUN=<run id>.
 * Provider keys are scrubbed by the orchestrator so the embedding path is
 * provably the local fallback, not a network provider.
 *
 * Exit codes (last stdout line is always a JSON receipt):
 * 0 = SEEDED (DEEP nodes READY). 1 = FAILED (product-level failure).
 * 3 = BLOCKED (environment: weights not staged).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Anclaje al repo: los servicios resuelven almacenamiento relativo al cwd
// (db/, data/). El script se auto-ancla a la raiz del repo sin importar el
// cwd de lanzamiento (en jaula el chroot arranca en /).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(REPO_ROOT);

const RUN = process.env.MEMORY_OS_RESTART_RUN;
if (!RUN) { console.error('MEMORY_OS_RESTART_RUN missing'); process.exit(1); }

const receipt = (status: string, extra: Record<string, unknown> = {}) =>
    console.log('OS_RESTART_RECEIPT ' + JSON.stringify({ status, run: RUN, ...extra }));

const MODEL_DIR = path.join(REPO_ROOT, 'models', 'Xenova', 'all-MiniLM-L6-v2');
// Los 5 archivos del modelo que el staging registra (lote6-P1-fs.txt);
// alineado con el doc (revisor lote 7, hallazgo 1).
const REQUIRED = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt', path.join('onnx', 'model_quantized.onnx')];
const missing = REQUIRED.filter(f => !fs.existsSync(path.join(MODEL_DIR, f)));
if (missing.length) {
    receipt('BLOCKED', { reason: `local model weights not staged at ./models/Xenova/all-MiniLM-L6-v2 (missing: ${missing.join(', ')})` });
    process.exit(3);
}

async function waitFor(cond: () => Promise<boolean>, ms = 60000, step = 250): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < ms) { if (await cond()) return; await new Promise(r => setTimeout(r, step)); }
    throw new Error('waitFor timeout');
}

async function main() {
    const { MemoryTier } = await import('../../types');
    const { continuum } = await import('../../services/continuumMemory') as any;

    const TARGET = `${RUN} principios de termodinamica entropia y energia libre`;
    const DECOY = `${RUN} instrucciones para armar una bicicleta de montana`;
    // store() returns void; ids must be pre-generated and threaded via extra.id
    // (continuumMemory.ts:394, 433) or the verify phase has nothing to look up.
    const SEED = [
        { tier: MemoryTier.WORKING, content: `${RUN} agenda semanal del equipo de ventas y sus objetivos` },
        { tier: MemoryTier.MEDIUM, content: `${RUN} receta de sopa de pollo con verduras y papa` },
        { tier: MemoryTier.LONG, content: `${RUN} historial de mantenimiento del servidor de produccion` },
        { tier: MemoryTier.DEEP, content: TARGET },
    ];

    const ids: Record<string, string> = {};
    for (const s of SEED) {
        const id = crypto.randomUUID();
        await continuum.store(s.content, s.tier, ['OS_RESTART_TEST'], false, { id });
        ids[s.tier] = id;
    }
    ids.DECOY = crypto.randomUUID();
    await continuum.store(DECOY, MemoryTier.DEEP, ['OS_RESTART_TEST'], false, { id: ids.DECOY });
    await continuum.forceSave();

    // Real embedding lifecycle: ONLY the DEEP nodes must reach READY with the
    // real local model. The other tiers stay EMBEDDING_PENDING by design (see
    // header). Checking any-RUN-content here was the lote-6 false failure.
    const { lancedbService } = await import('../../services/lancedbService');
    await waitFor(async () => {
        const pending = await lancedbService.pendingEmbeddings(500);
        return !pending.some((n: any) => n.content === TARGET || n.content === DECOY);
    });

    // F10: la evidencia debe mostrar las rutas REALES usadas - overrides de
    // entorno (deben ser null tras el scrub) y los archivos creados en el fs
    // real de la jaula (/repo/db, /repo/data), no en tmpfs.
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
    receipt('SEEDED', { ids, node: process.version, storage: {
        overrides: {
            SILHOUETTE_LANCEDB_PATH: process.env.SILHOUETTE_LANCEDB_PATH ?? null,
            SILHOUETTE_DB_PATH: process.env.SILHOUETTE_DB_PATH ?? null,
            SILHOUETTE_IDENTITY_DB_PATH: process.env.SILHOUETTE_IDENTITY_DB_PATH ?? null,
            SILHOUETTE_TOOLS_DB_PATH: process.env.SILHOUETTE_TOOLS_DB_PATH ?? null,
        },
        cwd: process.cwd(), tmpdir: process.env.TMPDIR ?? null,
        dbFiles: rel('db'), dataFiles: rel('data'),
    } });
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
        receipt('FAILED', { reason: String(e?.message ?? e) });
        try { const { redisClient } = await import('../../services/redisClient'); await redisClient.disconnect().catch(() => {}); } catch {}
        process.exit(1);
    });
