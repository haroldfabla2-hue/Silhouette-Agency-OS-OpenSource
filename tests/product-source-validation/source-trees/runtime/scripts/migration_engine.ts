import fs from 'fs';
import path from 'path';

const sourceRoot = process.cwd();
const targetName = 'Silhouette AGI';
const targetRoot = path.join(sourceRoot, targetName);

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

const silhouetteSafe = ['src', 'config', 'requirements.txt', 'start_silhouette.bat', 'universalprompts'];
const scriptsSafe = ['install.sh', 'install.ps1', 'bootstrap_v2.ts', 'purge_internal_docs.ts'];

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

try {
    console.log(`Starting migration to ${targetRoot}...`);
    if (!fs.existsSync(targetRoot)) fs.mkdirSync(targetRoot, { recursive: true });

    // 1. Dirs
    for (const dir of safeDirs) {
        const src = path.join(sourceRoot, dir);
        const dest = path.join(targetRoot, dir);
        if (fs.existsSync(src)) {
            console.log(`Migrating directory: ${dir}`);
            copyRecursiveSync(src, dest);
        }
    }

    // 2. Root Files
    for (const file of safeFiles) {
        const src = path.join(sourceRoot, file);
        const dest = path.join(targetRoot, file);
        if (fs.existsSync(src)) {
            console.log(`Migrating file: ${file}`);
            fs.copyFileSync(src, dest);
        }
    }

    // 3. Modelfile_*
    fs.readdirSync(sourceRoot).forEach(f => {
        if (f.startsWith('Modelfile_')) {
            console.log(`Migrating Model Configuration: ${f}`);
            fs.copyFileSync(path.join(sourceRoot, f), path.join(targetRoot, f));
        }
    });

    // 4. Silhouette Surgery
    const silSrc = path.join(sourceRoot, 'silhouette');
    const silDest = path.join(targetRoot, 'silhouette');
    if (fs.existsSync(silSrc)) {
        if (!fs.existsSync(silDest)) fs.mkdirSync(silDest, { recursive: true });
        for (const item of silhouetteSafe) {
            const s = path.join(silSrc, item);
            const d = path.join(silDest, item);
            if (fs.existsSync(s)) {
                console.log(`Migrating core: silhouette/${item}`);
                copyRecursiveSync(s, d);
            }
        }
    }

    // 5. Scripts Surgery
    const scriptsSrc = path.join(sourceRoot, 'scripts');
    const scriptsDest = path.join(targetRoot, 'scripts');
    if (fs.existsSync(scriptsSrc)) {
        if (!fs.existsSync(scriptsDest)) fs.mkdirSync(scriptsDest, { recursive: true });
        for (const f of scriptsSafe) {
            const s = path.join(scriptsSrc, f);
            const d = path.join(scriptsDest, f);
            if (fs.existsSync(s)) {
                console.log(`Migrating script: scripts/${f}`);
                fs.copyFileSync(s, d);
            }
        }
    }

    console.log('--- MIGRATION VERIFIED AND COMPLETE ---');
} catch (error) {
    console.error(`Migration failed: ${error.message}`);
}
