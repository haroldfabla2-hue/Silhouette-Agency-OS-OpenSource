/**
 * SILHOUETTE AGENCY OS — Unified Boot Manager
 *
 * This script multiplexes the frontend (Vite) and backend (Node.js Orchestrator)
 * processes into a single terminal window, coloring their outputs.
 * It also handles graceful shutdown on Ctrl+C.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Optional: Use ANSI escape codes if chalk is not available
const CS = {
    RES: '\x1b[0m',
    CYN: '\x1b[36m',
    BLU: '\x1b[34m',
    GRY: '\x1b[90m',
    RED: '\x1b[31m',
    YLW: '\x1b[33m'
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

function printHeader() {
    console.log(`\n${CS.BLU}=======================================================${CS.RES}`);
    console.log(`${CS.CYN}       SILHOUETTE AGENCY OS — COGNITIVE KERNEL         ${CS.RES}`);
    console.log(`${CS.BLU}=======================================================${CS.RES}`);
    console.log(`${CS.GRY} Booting unified processes... Press Ctrl+C to shutdown ${CS.RES}\n`);
}

const processes: ChildProcess[] = [];

function startProcess(name: string, command: string, args: string[], color: string, prefix: string) {
    const child = spawn(command, args, { cwd: PROJECT_ROOT, shell: true });

    child.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) {
                console.log(`${color}[${prefix}]${CS.RES} ${line}`);
            }
        }
    });

    child.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) {
                console.log(`${CS.RED}[${prefix} ERR]${CS.RES} ${line}`);
            }
        }
    });

    child.on('close', (code) => {
        console.log(`${color}[${prefix}]${CS.RES} Process exited with code ${code}`);
    });

    processes.push(child);
    return child;
}

function shutdown() {
    console.log(`\n${CS.YLW}[SYSTEM] Shutdown signal received. Halting cognitive OS gracefully...${CS.RES}`);
    for (const p of processes) {
        if (!p.killed) {
            // In Windows, sending SIGINT to shell wrapper doesn't cleanly kill children.
            // But we do our best.
            p.kill('SIGINT');
        }
    }
    setTimeout(() => {
        console.log(`${CS.YLW}[SYSTEM] Forced exit.${CS.RES}`);
        process.exit(0);
    }, 3000);
}

// Intercept Ctrl+C
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
    printHeader();

    // Spawn Kernel (Backend)
    startProcess('Kernel', npmCmd, ['run', 'server'], CS.BLU, 'KERNEL');

    // Slight delay to let backend start occupying port 3005 before UI
    setTimeout(() => {
        // Spawn UI (Frontend)
        startProcess('UI', npmCmd, ['run', 'dev'], CS.CYN, '  UI  ');
    }, 1500);
}

main().catch(err => {
    console.error(`\n${CS.RED}[SYSTEM] Boot error: ${err.message}${CS.RES}`);
    process.exit(1);
});
