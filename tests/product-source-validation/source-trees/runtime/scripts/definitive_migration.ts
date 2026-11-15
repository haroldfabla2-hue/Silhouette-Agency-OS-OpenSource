import fs from 'fs';
import path from 'path';

const sourceRoot = process.cwd();
const targetName = 'Silhouette AGI';
const targetRoot = path.join(sourceRoot, targetName);

if (!fs.existsSync(targetRoot)) {
    fs.mkdirSync(targetRoot, { recursive: true });
}

// SAFE LIST from implementation_plan_migration.md
const safeDirs = [
    'server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine',
    'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts',
    'config', 'data', 'models', 'cli', 'firebase', 'mocks', 'tests', 'silhouette'
];

const safeFiles = [
    'App.tsx', 'index.tsx', 'index.html', 'index.css', 'constants.ts', 'types.ts',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
    'vite.config.ts', 'vitest.config.ts', 'tailwind.config.js', 'postcss.config.js',
    'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md',
    'SECURITY.md', 'INSTALL.md', 'Dockerfile', 'docker-compose.yml', '.gitignore',
    '.dockerignore', '.gitattributes', '.eslintrc.json', 'silhouette.config.json',
    'start_all.bat', 'kill_all.bat', 'setup.bat'
];

function recursiveCopy(src, dest) {
    if (src.includes('node_modules') || src.includes('.git') || src.includes('.gemini') || src.includes('.agent')) return;

    try {
        const stats = fs.statSync(src);
        if (stats.isDirectory()) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            fs.readdirSync(src).forEach(child => {
                recursiveCopy(path.join(src, child), path.join(dest, child));
            });
        } else {
            // Check if it's a sensitive file we should skip
            const filename = path.basename(src);
            if (filename === '.env.local' || filename.startsWith('silhouette_chat') || filename === 'appsettings.local.json') {
                return;
            }
            fs.copyFileSync(src, dest);
            // Verify immediate existence
            if (fs.existsSync(dest)) {
                // console.log(`[OK] ${path.relative(sourceRoot, src)}`);
            } else {
                console.error(`[FAIL] ${path.relative(sourceRoot, src)} failed to reach VFS.`);
            }
        }
    } catch (e) {
        console.error(`[ERROR] ${src}: ${e.message}`);
    }
}

console.log('--- STARTING DEFINITIVE MIGRATION ---');

// 1. Copy Files
safeFiles.forEach(file => {
    const s = path.join(sourceRoot, file);
    const d = path.join(targetRoot, file);
    if (fs.existsSync(s)) {
        console.log(`Copying file: ${file}`);
        fs.copyFileSync(s, d);
    }
});

// 2. Copy Directories
safeDirs.forEach(dir => {
    const s = path.join(sourceRoot, dir);
    const d = path.join(targetRoot, dir);
    if (fs.existsSync(s)) {
        console.log(`Syncing directory: ${dir}`);
        recursiveCopy(s, d);
    }
});

// 3. Special: Copy fix_*.bat and Modelfile_*
fs.readdirSync(sourceRoot).forEach(file => {
    if (file.startsWith('fix_') && file.endsWith('.bat')) {
        console.log(`Copying maintenance script: ${file}`);
        fs.copyFileSync(path.join(sourceRoot, file), path.join(targetRoot, file));
    }
    if (file.startsWith('Modelfile_')) {
        console.log(`Copying AI config: ${file}`);
        fs.copyFileSync(path.join(sourceRoot, file), path.join(targetRoot, file));
    }
});

console.log('--- MIGRATION ENGINE FINISHED ---');
const finalCount = fs.readdirSync(targetRoot).length;
console.log(`Root contents count in ${targetName}: ${finalCount}`);
