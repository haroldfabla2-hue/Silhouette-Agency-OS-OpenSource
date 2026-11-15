import fs from 'fs';
import path from 'path';

const root = process.cwd();
const target = path.join(root, 'STAGING_READY');

if (!fs.existsSync(target)) {
    fs.mkdirSync(target);
    console.log('✅ Created root target.');
}

fs.copyFileSync(path.join(root, 'package.json'), path.join(target, 'package.json'));
console.log('✅ Copied verification file.');
