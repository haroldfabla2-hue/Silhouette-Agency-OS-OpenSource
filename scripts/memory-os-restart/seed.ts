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
 * Env (set by the orchestrator): MEMORY_OS_RESTART_RUN=<run id>.
 * Provider keys are scrubbed by the orchestrator so the embedding path is
 * provably the local fallback, not a network provider.
 *
 * Exit codes: 0 = seeded + READY receipt printed (last stdout line, JSON).
 * 1 = failure. 3 = BLOCKED (weights not staged).
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
const REQUIRED = ['config.json', 'tokenizer.json', path.join('onnx', 'model_quantized.onnx')];
const missing = REQUIRED.filter(f => !fs.existsSync(path.join(MODEL_DIR, f)));
if (missing.length) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: `local model weights not staged at ./models/Xenova/all-MiniLM-L6-v2 (missing: ${missing.join(', ')})` }));
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

    const SEED = [
        { tier: MemoryTier.WORKING, content: `${RUN} agenda semanal del equipo de ventas y sus objetivos` },
        { tier: MemoryTier.MEDIUM, content: `${RUN} receta de sopa de pollo con verduras y papa` },
        { tier: MemoryTier.LONG, content: `${RUN} historial de mantenimiento del servidor de produccion` },
        { tier: MemoryTier.DEEP, content: `${RUN} principios de termodinamica entropia y energia libre` },
    ];
    const DECOY = `${RUN} instrucciones para armar una bicicleta de montana`;

    const ids: Record<string, string> = {};
    for (const s of SEED) {
        const node = await continuum.store(s.content, s.tier, ['OS_RESTART_TEST']);
        ids[s.tier] = node?.id ?? '';
    }
    const decoyNode = await continuum.store(DECOY, MemoryTier.DEEP, ['OS_RESTART_TEST']);
    ids.DECOY = decoyNode?.id ?? '';
    await continuum.forceSave();

    // Real embedding lifecycle: the DEEP nodes must reach READY (not stay
    // EMBEDDING_PENDING) with the real local model before we hand over.
    const { lancedbService } = await import('../../services/lancedbService');
    await waitFor(async () => {
        const pending = await lancedbService.pendingEmbeddings(500);
        return !pending.some((n: any) => n.content?.includes(RUN));
    });

    console.log(JSON.stringify({ status: 'SEEDED', run: RUN, ids }));
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
    .catch(async (e) => { console.error(e); try { const { redisClient } = await import('../../services/redisClient'); await redisClient.disconnect().catch(() => {}); } catch {} process.exit(1); });
