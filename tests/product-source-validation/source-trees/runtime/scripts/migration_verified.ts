import fs from 'fs';
import path from 'path';

const source = process.cwd();
const target = path.join(source, 'Silhouette AGI');

if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
}

function sync(src, dest) {
    if (src.includes('node_modules') || src.includes('.git') || src.includes('.gemini') || src.includes('.agent')) return;

    try {
        const stats = fs.statSync(src);
        if (stats.isDirectory()) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            fs.readdirSync(src).forEach(child => sync(path.join(src, child), path.join(dest, child)));
        } else {
            const filename = path.basename(src);
            if (filename === '.env.local' || filename.startsWith('silhouette_chat') || filename === 'appsettings.local.json' || filename === 'FINAL_DISTRIBUTION.zip' || filename === 'SILHOUETTE_AGI_DISTRIBUTION.zip') return;

            fs.copyFileSync(src, dest);
            // console.log(`[OK] ${path.relative(source, src)}`);
        }
    } catch (e) {
        // Silent error to avoid log bloat
    }
}

// SAFE LIST
const items = [
    'server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine',
    'components', 'hooks', 'public', 'constants', 'docs', 'logo', 'universalprompts',
    'config', 'data', 'models', 'cli', 'firebase', 'mocks', 'tests', 'silhouette',
    'App.tsx', 'index.tsx', 'index.html', 'index.css', 'constants.ts', 'types.ts',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
    'vite.config.ts', 'vitest.config.ts', 'tailwind.config.js', 'postcss.config.js',
    'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md',
    'SECURITY.md', 'INSTALL.md', 'Dockerfile', 'docker-compose.yml', '.gitignore',
    '.dockerignore', '.gitattributes', '.eslintrc.json', 'silhouette.config.json',
    'start_all.bat', 'kill_all.bat', 'setup.bat'
];

console.log('--- STARTING FORENSIC SYNC ---');
items.forEach(item => {
    const s = path.join(source, item);
    const d = path.join(target, item);
    if (fs.existsSync(s)) {
        console.log(`Syncing: ${item}`);
        sync(s, d);
    }
});
console.log('--- SYNC FINISHED ---');
console.log(`Core File Count: ${fs.readdirSync(target).length}`);
