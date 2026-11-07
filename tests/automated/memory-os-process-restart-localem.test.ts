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
    const tail = out.trim().split('\n').slice(-8).join('\n');
    let receipt: any = null;
    for (const line of out.trim().split('\n').reverse()) {
        try { const j = JSON.parse(line); if (j && j.status) { receipt = j; break; } } catch { /* log lines */ }
    }
    if (res.error) throw new Error(`fase ${script} no completo: ${res.error.message}\n${tail}`);
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

        const verify = runPhase('scripts/memory-os-restart/verify.ts');
        if (verify.code === 3) throw new Error(`BLOCKED: ${verify.receipt?.reason ?? verify.tail}`);
        if (verify.code !== 0) throw new Error(`fase verify fallo rc=${verify.code}\n${verify.tail}`);
        expect(verify.code).toBe(0);
        expect(verify.receipt?.status).toBe('PASS');
        expect(verify.receipt?.top1Similarity).toBeGreaterThan(0.9999);
        expect(verify.receipt?.dimension).toBe(384);
    }, 660_000);
});
