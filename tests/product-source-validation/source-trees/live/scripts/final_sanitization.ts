import fs from 'fs';
import path from 'path';

const root = process.cwd();

const itemsToDelete = [
    'ANALISIS_CRITICO_SILHOUETTE.md',
    'ANALISIS_DE_IMPACTO_PROPUESTA.md',
    'ANALISIS_ESTRATEGICO.md',
    'ARQUITECTURA_EVOLUTIVA.md',
    'ARQUITECTURA_INTROSPECCION_V2.md',
    'CAPABILITIES.md',
    'DIRECTIVA_OPERACIONAL.md',
    'MAPA_DE_MD.md',
    'PA-009-Holistic-Sleep.md',
    'PA-037.md',
    'PLAN_DE_ACCION.md',
    'PLAN_DE_ACCION_FASE_7.md',
    'PLAN_DE_IMPLEMENTACION_DASHBOARD.md',
    'PLAN_DE_IMPLEMENTACION_SUPERVISOR.md',
    'PLAN_INTEGRACION_NEXUS.md',
    'PROJECT_MEMORY.md',
    'PROPUESTA_DISCUBRIMIENTO_NEUROCOGNITIVO.md',
    'agents.md',
    'identity.md',
    'nexus-canvas-ai-specs.md',
    'nexus-canvas-architecture.md',
    'nexus-canvas-deployment.md',
    'nexus-canvas-executive.md',
    'nexus-canvas-index.md',
    'nexus-canvas-prd.md',
    'nexus-canvas-quickstart.md',
    'nexus-canvas-roadmap.md',
    'soul.md',
    'task.md',
    'tools.md',
    'user.md',
    'walkthrough.md',
    'BITACORA.md',
    'Job a5b3c5ec-eb8f-4e90-bdcb-fe3a7717be57.json',
    'console.error(e))',
    "console.log('PDF",
    "console.log(i+1",
    'cost_metrics.json',
    'debug_cpu.js',
    'debug_memory.ts',
    'debug_ram.js',
    'diagnose_root_cause.js',
    'env_snippet.txt',
    'r.json()).then(console.log).catch(console.error)',
    'seed_memory.ts',
    'silhouette_chat_history.json',
    'silhouette_chat_sessions.json',
    'silhouette_consciousness.json',
    'silhouette_cost_metrics.json',
    'silhouette_genesis_db.json',
    'silhouette_memory_db.json',
    'silhouette_ui_state.json',
    'silhouette_vfs_db.json',
    'temp_voicecheck.mp3',
    'test_output.wav',
    'test_terminal.ts',
    'types.ts.temp_actions',
    'verify_memory_full.ts',
    'verify_universal_pipeline.ts',
    'wan_workflow.json',
    '{',
    '-L',
    '-o'
];

const dirsToDelete = [
    'temp_openclaw',
    'coverage',
    'db',
    'dist',
    'analysis'
];

console.log(`Starting final surgical strike in ${root}...`);

itemsToDelete.forEach(item => {
    const fullPath = path.join(root, item);
    if (fs.existsSync(fullPath)) {
        try {
            fs.unlinkSync(fullPath);
            console.log(`✅ Deleted file: ${item}`);
        } catch (e) {
            console.error(`❌ Failed to delete file ${item}: ${e.message}`);
        }
    }
});

dirsToDelete.forEach(dir => {
    const fullPath = path.join(root, dir);
    if (fs.existsSync(fullPath)) {
        try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`✅ Deleted directory: ${dir}`);
        } catch (e) {
            console.error(`❌ Failed to delete directory ${dir}: ${e.message}`);
        }
    }
});

console.log("Surgical strike complete.");
