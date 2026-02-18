import fs from 'fs';
import path from 'path';

const sourceRoot = process.cwd();
const targetName = 'Silhouette AGI';
const targetRoot = path.join(sourceRoot, targetName);

if (!fs.existsSync(targetRoot)) {
    fs.mkdirSync(targetRoot, { recursive: true });
}

function copyFile(src, dest) {
    try {
        const stats = fs.statSync(src);
        if (stats.isDirectory()) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            fs.readdirSync(src).forEach(child => {
                copyFile(path.join(src, child), path.join(dest, child));
            });
        } else {
            fs.copyFileSync(src, dest);
            // console.log(`[OK] ${path.relative(sourceRoot, src)}`);
        }
    } catch (e) {
        console.error(`[FAIL] ${src}: ${e.message}`);
    }
}

const batch1 = ['server', 'services', 'types', 'packages', 'utils', 'voice_engine', 'reasoning_engine'];

console.log('--- STARTING BATCH 1 SYNC ---');
batch1.forEach(item => {
    const s = path.join(sourceRoot, item);
    const d = path.join(targetRoot, item);
    if (fs.existsSync(s)) {
        console.log(`Syncing: ${item}`);
        copyFile(s, d);
    }
});
console.log('--- BATCH 1 SYNC COMPLETE ---');
console.log(`Root contents of ${targetName}: ${fs.readdirSync(targetRoot).join(', ')}`);
