import fs from 'fs';
import path from 'path';

const filesToPurge = [
    'BITACORA.md',
    'PLAN_DE_ACCION.md',
    'PLAN_DE_ACCION_FASE_7.md',
    'PLAN_DE_IMPLEMENTACION_DASHBOARD.md',
    'PLAN_DE_IMPLEMENTACION_SUPERVISOR.md',
    'PLAN_INTEGRACION_NEXUS.md',
    'PROJECT_MEMORY.md',
    'MAPA_DE_MD.md',
    'ANALISIS_CRITICO_SILHOUETTE.md',
    'ANALISIS_DE_IMPACTO_PROPUESTA.md',
    'ANALISIS_ESTRATEGICO.md',
    'PROPUESTA_DISCUBRIMIENTO_NEUROCOGNITIVO.md',
    'ARQUITECTURA_INTROSPECCION_V2.md',
    'ARQUITECTURA_EVOLUTIVA.md',
    'CAPABILITIES.md',
    'DIRECTIVA_OPERACIONAL.md',
    'identity.md',
    'soul.md',
    'agents.md',
    'tools.md',
    'user.md'
];

const patterns = [
    /^PA-.*\.md$/,
    /^nexus-canvas-.*\.md$/,
    /^PROPUESTA_.*\.md$/,
    /^PLAN_DE_IMPLEMENTACION_.*\.md$/
];

const dir = process.cwd();

console.log(`Starting purge in ${dir}...`);

// 1. Fixed filenames
filesToPurge.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.existsSync(fullPath)) {
        try {
            fs.unlinkSync(fullPath);
            console.log(`✅ Deleted: ${file}`);
        } catch (e) {
            console.error(`❌ Failed to delete ${file}: ${e.message}`);
        }
    }
});

// 2. Patterns
const allFiles = fs.readdirSync(dir);
allFiles.forEach(file => {
    if (patterns.some(p => p.test(file))) {
        const fullPath = path.join(dir, file);
        try {
            fs.unlinkSync(fullPath);
            console.log(`✅ Deleted (Pattern): ${file}`);
        } catch (e) {
            console.error(`❌ Failed to delete pattern match ${file}: ${e.message}`);
        }
    }
});

console.log("Purge complete.");
