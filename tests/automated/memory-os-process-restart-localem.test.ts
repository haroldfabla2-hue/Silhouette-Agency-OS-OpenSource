/**
 * Etapa 3 (cierre de frontera): memoria sobrevive un REINICIO REAL DE
 * PROCESO OS, con almacenamiento real y el modelo local de embeddings REAL.
 *
 * Nivel E1-semantico del contrato 25-oct (s16): DB/FS/procesos reales en
 * local, sin sustitutos. NO es E2 (servicio integrado HTTP/WS/auth/Redis) ni
 * prueba la ruta Gemini 768d de proveedor real - ambas quedan BLOCKED, no
 * PASS, hasta entorno/autorizacion.
 *
 * Estructura: este test orquesta DOS PROCESOS OS hijos (tsx):
 *   1. seed.ts   - siembra 1 nodo por nivel via continuum.store real + un
 *                  decoy DEEP, con embeddings reales del modelo local
 *                  (fallback canonico sin claves API), espera estado READY.
 *   2. verify.ts - proceso nuevo: arranque fresco contra el mismo
 *                  almacenamiento en disco; verifica recuperacion de los 4
 *                  niveles, persistencia vectorial con identidad
 *                  (LOCAL_EMBEDDING_IDENTITY, 384 dims), binding de identidad
 *                  y ausencia de re-embedding.
 *
 * Sin mocks, sin vectores fixture, sin red, sin credenciales.
 *
 * Requisito de entorno (BLOCKED, no skip silencioso): pesos MiniLM staged
 * en ./models/Xenova/all-MiniLM-L6-v2/ (ver
 * docs/verification/memory-etapa3-os-restart-block.md). Si faltan, este
 * test FALLA con mensaje BLOCKED explicito.
 *
 * Tiempos: estimaciones hasta medicion en jaula (carga del modelo x2
 * procesos + inferencia CPU); timeout declarado 300s por fase.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RUN = `osrestart-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const CWD = fs.existsSync('/repo/package.json') ? '/repo' : process.cwd();
const TSX = path.join(CWD, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MODEL_DIR = path.join(CWD, 'models', 'Xenova', 'all-MiniLM-L6-v2');
const REQUIRED_MODEL_FILES = ['config.json', 'tokenizer.json', path.join('onnx', 'model_quantized.onnx')];

// Proveedor forzado a local: se eliminan TODAS las claves de proveedor del
// entorno del hijo (la jaula ya no tiene credenciales; esto lo hace
// estructural y auditable dentro del test).
const SCRUBBED_KEYS = [
    'API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'NVIDIA_API_KEY',
    'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OLLAMA_CLOUD_API_KEY',
    'OLLAMA_CLOUD_MODEL', 'OLLAMA_LOCAL_ENABLED',
    // F10 (revisor): el setup por-worker de vitest redirige el storage a
    // mkdtemp(os.tmpdir()) - en la jaula eso es /scratch, tmpfs en RAM, y la
    // prueba de persistencia entre procesos correria sobre RAM en vez del fs
    // real de la jaula (/repo/db, /repo/data). Los hijos usan las rutas
    // CANONICAS por defecto (los defaults de produccion no se tocan).
    'SILHOUETTE_LANCEDB_PATH', 'SILHOUETTE_DB_PATH',
    'SILHOUETTE_IDENTITY_DB_PATH', 'SILHOUETTE_TOOLS_DB_PATH',
];

function childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, MEMORY_OS_RESTART_RUN: RUN };
    for (const k of SCRUBBED_KEYS) delete env[k];
    delete env.VITEST;           // hijos = procesos de produccion, no workers
    delete env.VITEST_WORKER_ID; // DB canonica por defecto, compartida por ambas fases
    return env;
}

function runPhase(script: string): { code: number | null; receipt: any; tail: string } {
    const res = spawnSync(process.execPath, [TSX, script], {
        cwd: CWD, env: childEnv(), encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
    });
    const out = `${res.stdout ?? ''}`;
    const serr = `${res.stderr ?? ''}`;
    // stderr del hijo tambien entra al tail (revisor #5): sin el, un fallo
    // fuera de stdout quedaba invisible para la clasificacion.
    const tail = out.trim().split('\n').slice(-8).join('\n')
        + (serr.trim() ? `\n[stderr]\n${serr.trim().split('\n').slice(-4).join('\n')}` : '');
    // Recibo por prefijo unico: el cleanup del hijo puede logear despues del
    // recibo, asi que "ultima linea JSON" no es garantia (revisor lote 7, #2).
    // Se toma la ULTIMA linea prefijada (la definitiva del proceso).
    let receipt: any = null;
    for (const line of out.split('\n')) {
        if (!line.startsWith('OS_RESTART_RECEIPT ')) continue;
        try { receipt = JSON.parse(line.slice('OS_RESTART_RECEIPT '.length)); } catch { /* corrupta */ }
    }
    // Re-emision al log del orquestador (revisor lote 7, F1): el recibo del
    // hijo debe quedar en la evidencia del payload aunque la fase pase - sin
    // esto la clasificacion del ledger caia al fallback por rc sin recibo.
    if (receipt) console.log('OS_RESTART_RECEIPT ' + JSON.stringify(receipt));
    // Timeout/kill del spawn dentro de una ventana presupuestada: la fase no
    // pudo completarse por entorno/ventana -> BLOCKED declarado, no FAIL de
    // producto (revisor lote 7, #2).
    if (res.error) throw new Error(`BLOCKED: fase ${script} no completo (spawn: ${res.error.message}) - ventana/entorno, no evidencia de producto\n${tail}`);
    return { code: res.status, receipt, tail };
}

describe('memoria sobrevive reinicio real de proceso OS (storage real + embeddings locales reales)', () => {
    it('siembra en un proceso y recupera en otro, sin sustitutos', () => {
        // BLOCKED explicito (s16: declarar, no esconder como skip ni PASS).
        const missing = REQUIRED_MODEL_FILES.filter(f => !fs.existsSync(path.join(MODEL_DIR, f)));
        if (missing.length || !fs.existsSync(TSX)) {
            throw new Error(`BLOCKED: pesos MiniLM no staged en ./models/Xenova/all-MiniLM-L6-v2 (faltan: ${missing.join(', ') || 'ninguno'})${fs.existsSync(TSX) ? '' : ' o tsx no resuelve'}. Ver docs/verification/memory-etapa3-os-restart-block.md`);
        }

        const seed = runPhase('scripts/memory-os-restart/seed.ts');
        if (seed.code === 3) throw new Error(`BLOCKED: ${seed.receipt?.reason ?? seed.tail}`);
        if (seed.code !== 0) throw new Error(`fase seed fallo rc=${seed.code}\n${seed.tail}`);
        expect(seed.code).toBe(0);
        expect(seed.receipt?.status).toBe('SEEDED');
        // PASS invalido si el storage no fue el canonico real (revisor r3):
        // overrides DEBEN ser null y el fs real de la jaula DEBE tener datos.
        const EXPECTED_OVERRIDES = {
            SILHOUETTE_LANCEDB_PATH: null, SILHOUETTE_DB_PATH: null,
            SILHOUETTE_IDENTITY_DB_PATH: null, SILHOUETTE_TOOLS_DB_PATH: null,
        };
        expect(seed.receipt?.storage?.overrides).toEqual(EXPECTED_OVERRIDES);
        expect((seed.receipt?.storage?.dbFiles?.length ?? 0) + (seed.receipt?.storage?.dataFiles?.length ?? 0)).toBeGreaterThan(0);

        const verify = runPhase('scripts/memory-os-restart/verify.ts');
        if (verify.code === 3) throw new Error(`BLOCKED: ${verify.receipt?.reason ?? verify.tail}`);
        if (verify.code !== 0) throw new Error(`fase verify fallo rc=${verify.code}\n${verify.tail}`);
        expect(verify.code).toBe(0);
        expect(verify.receipt?.status).toBe('PASS');
        expect(verify.receipt?.storage?.overrides).toEqual(EXPECTED_OVERRIDES);
        expect((verify.receipt?.storage?.dbFiles?.length ?? 0) + (verify.receipt?.storage?.dataFiles?.length ?? 0)).toBeGreaterThan(0);
        expect(verify.receipt?.top1Similarity).toBeGreaterThan(0.9999);
        expect(verify.receipt?.dimension).toBe(384);
    }, 660_000);
});
