#!/usr/bin/env node
/**
 * Isolated Sandboxed Javascript Execution Runner
 * Silhouette OS Security Layer
 */

import vm from 'node:vm';
import fs from 'node:fs';

function run() {
    try {
        // Read JSON input from standard input (stdin)
        const inputData = fs.readFileSync(0, 'utf-8');
        if (!inputData.trim()) {
            throw new Error("Empty execution payload received.");
        }

        const payload = JSON.parse(inputData);
        const code = payload.code;
        const args = payload.args || {};

        const logs = [];

        // Define a clean, restricted execution sandbox context
        const sandboxContext = {
            args,
            console: {
                log: (...msg) => logs.push(msg.map(m => typeof m === 'object' ? JSON.stringify(m) : String(m)).join(' ')),
                warn: (...msg) => logs.push('[WARN] ' + msg.map(m => typeof m === 'object' ? JSON.stringify(m) : String(m)).join(' ')),
                error: (...msg) => logs.push('[ERROR] ' + msg.map(m => typeof m === 'object' ? JSON.stringify(m) : String(m)).join(' '))
            },
            JSON,
            Math,
            Date,
            Array,
            Object,
            String,
            Number,
            Boolean,
            RegExp,
            setTimeout,
            clearTimeout
        };

        // Create the execution context
        vm.createContext(sandboxContext);

        // Wrap code in an immediately invoked async function expression
        // to support top-level await if needed, and to cleanly return output.
        const wrappedCode = `
            (async () => {
                ${code}
            })()
        `;

        // Compile and run script with a local timeout safety check
        const script = new vm.Script(wrappedCode);
        
        script.runInContext(sandboxContext, {
            timeout: 4000, // Inner timeout: slightly lower than the process monitor timeout
            breakOnSigint: true
        }).then(result => {
            // Write success response
            console.log(JSON.stringify({
                success: true,
                result: result,
                logs: logs
            }));
            process.exit(0);
        }).catch(err => {
            console.log(JSON.stringify({
                success: false,
                error: err.message,
                logs: logs
            }));
            process.exit(0);
        });

    } catch (e) {
        console.log(JSON.stringify({
            success: false,
            error: e.message
        }));
        process.exit(0);
    }
}

run();
