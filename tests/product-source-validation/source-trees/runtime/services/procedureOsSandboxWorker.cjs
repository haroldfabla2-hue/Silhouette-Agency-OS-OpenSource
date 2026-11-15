'use strict';
// Deployment-owned closed interpreter. Not arbitrary-code or natural-language execution.
const fs = require('node:fs');
const crypto = require('node:crypto');
const contract = JSON.parse(fs.readFileSync(0, 'utf8'));
let operations = 0;
try {
    if (contract.schema !== 1 || !Array.isArray(contract.steps) || contract.steps.length < 1 || contract.steps.length > 32) throw Error('schema');
    let bytes = 0;
    for (const step of contract.steps) {
        if (!step || typeof step.path !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/.test(step.path)) throw Error('path');
        if (step.op === 'write' && Object.keys(step).sort().join(',') === 'op,path,text' && typeof step.text === 'string') bytes += Buffer.byteLength(step.text);
        else if (step.op !== 'assert' || Object.keys(step).sort().join(',') !== 'op,path,sha256' || !/^[a-f0-9]{64}$/.test(step.sha256)) throw Error('operation');
    }
    if (bytes > 1048576 || !contract.steps.some(s => s.op === 'assert')) throw Error('budget');
    for (const step of contract.steps) {
        if (step.op === 'write') {
            fs.mkdirSync(require('node:path').dirname(step.path), { recursive: true });
            fs.writeFileSync(step.path, step.text, { flag: 'wx' });
        } else if (crypto.createHash('sha256').update(fs.readFileSync(step.path)).digest('hex') !== step.sha256) throw Error('postcondition');
        operations++;
    }
    process.stdout.write(JSON.stringify({ succeeded: true, operations }));
} catch {
    process.stdout.write(JSON.stringify({ succeeded: false, operations }));
    process.exitCode = 1;
}
