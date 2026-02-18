import fs from 'fs';
import path from 'path';

const sourceRoot = process.cwd();
const targetName = 'Silhouette AGI';
const targetRoot = path.join(sourceRoot, targetName);

const safeDirs = [
    'server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine',
    'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts',
    'config', 'data', 'models', 'cli', 'mocks', 'tests', 'firebase'
];

const safeFiles = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
    'vite.config.ts', 'vitest.config.ts', 'App.tsx', 'index.tsx', 'index.html', 'index.css',
    'tailwind.config.js', 'postcss.config.js', 'README.md', 'LICENSE', 'CONTRIBUTING.md',
    'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'INSTALL.md', 'Dockerfile',
    'docker-compose.yml', '.gitignore', '.dockerignore', '.gitattributes', '.eslintrc.json',
    'silhouette.config.json', 'start_all.bat', 'kill_all.bat', 'setup.bat', 'constants.ts', 'types.ts'
];

const silhouetteSafe = ['src', 'config', 'requirements.txt', 'start_silhouette.bat', 'universalprompts'];
const scriptsSafe = ['install.sh', 'install.ps1', 'bootstrap_v2.ts', 'purge_internal_docs.ts'];

function copyRecursiveSync(src, dest) {
    if (!fs.existsSync(src)) return;
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach((child) => {
            copyRecursiveSync(path.join(src, child), path.join(dest, child));
        });
    } else {
        try {
            fs.copyFileSync(src, dest);
        } catch (e) {
            console.log(`[SKIP] Error copying ${src}: ${e.message}`);
        }
    }
}

console.log(`🚀 INICIANDO MIGRACIÓN MAESTRA A: ${targetRoot}`);

if (!fs.existsSync(targetRoot)) {
    fs.mkdirSync(targetRoot, { recursive: true });
}

// 1. Dirs
for (const dir of safeDirs) {
    const s = path.join(sourceRoot, dir);
    const d = path.join(targetRoot, dir);
    if (fs.existsSync(s)) {
        console.log(`Copiando directorio: ${dir}...`);
        copyRecursiveSync(s, d);
    }
}

// 2. Files
for (const file of safeFiles) {
    const s = path.join(sourceRoot, file);
    const d = path.join(targetRoot, file);
    if (fs.existsSync(s)) {
        console.log(`Copiando archivo raíz: ${file}`);
        try { fs.copyFileSync(s, d); } catch (e) { }
    }
}

// 3. Modelfiles
fs.readdirSync(sourceRoot).forEach(f => {
    if (f.startsWith('Modelfile_')) {
        console.log(`Copiando Modelfile: ${f}`);
        try { fs.copyFileSync(path.join(sourceRoot, f), path.join(targetRoot, f)); } catch (e) { }
    }
});

// 4. Silhouette Internal
const silSrc = path.join(sourceRoot, 'silhouette');
const silDest = path.join(targetRoot, 'silhouette');
if (fs.existsSync(silSrc)) {
    if (!fs.existsSync(silDest)) fs.mkdirSync(silDest, { recursive: true });
    for (const item of silhouetteSafe) {
        copyRecursiveSync(path.join(silSrc, item), path.join(silDest, item));
        console.log(`Copiando silhouette/${item}`);
    }
}

// 5. Scripts Internal
const srcScripts = path.join(sourceRoot, 'scripts');
const destScripts = path.join(targetRoot, 'scripts');
if (fs.existsSync(srcScripts)) {
    if (!fs.existsSync(destScripts)) fs.mkdirSync(destScripts, { recursive: true });
    for (const f of scriptsSafe) {
        const s = path.join(srcScripts, f);
        if (fs.existsSync(s)) {
            fs.copyFileSync(s, path.join(destScripts, f));
            console.log(`Copiando script: ${f}`);
        }
    }
}

console.log('\n✅ MIGRACIÓN QUIRÚRGICA COMPLETADA CON ÉXITO.');
console.log(`Ubicación: ${targetRoot}`);
