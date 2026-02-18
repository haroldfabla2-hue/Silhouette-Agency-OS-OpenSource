import fs from 'fs';
import path from 'path';

const source = process.cwd();
const target = path.join(source, 'Silhouette AGI');

if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
}

const safeDirs = [
    'server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine',
    'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts',
    'config', 'data', 'models', 'cli', 'mocks', 'tests'
];

const safeFiles = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
    'vite.config.ts', 'vitest.config.ts', 'App.tsx', 'index.tsx', 'index.html', 'index.css',
    'tailwind.config.js', 'postcss.config.js', 'README.md', 'LICENSE', 'CONTRIBUTING.md',
    'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'INSTALL.md', 'Dockerfile',
    'docker-compose.yml', '.gitignore', '.dockerignore', '.gitattributes', '.eslintrc.json',
    'silhouette.config.json', 'start_all.bat', 'kill_all.bat', 'setup.bat', 'constants.ts', 'types.ts'
];

function copyFileSync(src, dest) {
    try {
        fs.copyFileSync(src, dest);
        return true;
    } catch (e) {
        console.log(`Failed to copy file ${src}: ${e.message}`);
        return false;
    }
}

function copyFolderRecursiveSync(source, target) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }

    if (fs.lstatSync(source).isDirectory()) {
        const files = fs.readdirSync(source);
        files.forEach((file) => {
            const curSource = path.join(source, file);
            if (fs.lstatSync(curSource).isDirectory()) {
                copyFolderRecursiveSync(curSource, path.join(target, file));
            } else {
                copyFileSync(curSource, path.join(target, file));
            }
        });
    }
}

console.log('--- STARTING SURGICAL SYNC ---');

// 1. Copy Direct Top Directories
for (const dir of safeDirs) {
    const s = path.join(source, dir);
    const d = path.join(target, dir);
    if (fs.existsSync(s)) {
        console.log(`Syncing ${dir}...`);
        copyFolderRecursiveSync(s, d);
    }
}

// 2. Copy Top Files
for (const file of safeFiles) {
    const s = path.join(source, file);
    const d = path.join(target, file);
    if (fs.existsSync(s)) {
        copyFileSync(s, d);
    }
}

// 3. Modelfile_*
fs.readdirSync(source).forEach(f => {
    if (f.startsWith('Modelfile_')) {
        copyFileSync(path.join(source, f), path.join(target, f));
    }
});

// 4. Silhouette Surgery
const silSrc = path.join(source, 'silhouette');
const silDest = path.join(target, 'silhouette');
if (fs.existsSync(silSrc)) {
    if (!fs.existsSync(silDest)) fs.mkdirSync(silDest, { recursive: true });
    const silSafe = ['src', 'config', 'requirements.txt', 'start_silhouette.bat', 'universalprompts'];
    for (const item of silSafe) {
        const s = path.join(silSrc, item);
        const d = path.join(silDest, item);
        if (fs.existsSync(s)) {
            if (fs.lstatSync(s).isDirectory()) {
                copyFolderRecursiveSync(s, d);
            } else {
                copyFileSync(s, d);
            }
        }
    }
}

// 5. Scripts Surgery
const scriptsSrc = path.join(source, 'scripts');
const scriptsDest = path.join(target, 'scripts');
if (fs.existsSync(scriptsSrc)) {
    if (!fs.existsSync(scriptsDest)) fs.mkdirSync(scriptsDest, { recursive: true });
    const scriptSafe = ['install.sh', 'install.ps1', 'bootstrap_v2.ts', 'purge_internal_docs.ts'];
    for (const f of scriptSafe) {
        const s = path.join(scriptsSrc, f);
        const d = path.join(scriptsDest, f);
        if (fs.existsSync(s)) {
            copyFileSync(s, d);
        }
    }
}

console.log('--- SURGICAL SYNC COMPLETE ---');
