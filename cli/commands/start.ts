// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — START COMMAND
// Boots the full OS: Kernel (backend) + UI (frontend) + Daemon
// ═══════════════════════════════════════════════════════════════

import { spawn, ChildProcess } from 'child_process';
import { C, printCompactBanner, printSection, printCheck, isConfigured, getProjectRoot, Spinner,
         printSmartRecommendations } from '../utils/ui';
import { checkNodeVersion, checkEnvFile, checkApiKeys } from '../utils/checks';

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

interface StartOptions {
    kernelOnly?: boolean;
    uiOnly?: boolean;
    port?: string;
}

export async function startCommand(options: StartOptions) {
    printCompactBanner();

    // ── Pre-flight checks ────────────────────────────────────
    if (!isConfigured()) {
        printSection('Configuration Required', '⚠️');
        printCheck('fail', 'No configuration found');
        console.log(`    ${C.YELLOW}Run ${C.BOLD}silhouette setup${C.RESET}${C.YELLOW} first to configure your OS.${C.RESET}\n`);
        process.exit(1);
    }

    const projectRoot = getProjectRoot();
    const nodeCheck = checkNodeVersion();
    const envCheck = checkEnvFile(projectRoot);
    const keyCheck = checkApiKeys(projectRoot);

    printSection('Pre-Flight Checks', '🔎');
    printCheck(nodeCheck.status, nodeCheck.message, nodeCheck.detail);
    printCheck(envCheck.status, envCheck.message, envCheck.detail);
    printCheck(keyCheck.status, keyCheck.message, keyCheck.detail);

    if (keyCheck.status === 'fail') {
        console.log(`\n    ${C.RED}Cannot start without at least one LLM API key.${C.RESET}`);
        console.log(`    ${C.GRAY}Run: ${C.WHITE}silhouette setup${C.RESET}\n`);
        process.exit(1);
    }

    console.log();

    // ── Boot processes ───────────────────────────────────────
    const processes: ChildProcess[] = [];
    const port = options.port || '3005';

    printSection('Booting Cognitive Kernel', '🧠');

    if (!options.uiOnly) {
        const spinner = new Spinner('Starting API Kernel...');
        spinner.start();

        const kernel = spawn(npmCmd, ['run', 'server'], {
            cwd: projectRoot,
            shell: true,
            env: { ...process.env, PORT: port }
        });

        kernel.stdout?.on('data', (data) => {
            const text = data.toString();
            if (text.includes('IS ONLINE') || text.includes('listening')) {
                spinner.stop(`API Kernel online at port ${port}`, 'ok');
            }
            // Pipe output with prefix
            for (const line of text.split('\n')) {
                if (line.trim()) console.log(`    ${C.BLUE}[KERNEL]${C.RESET} ${line.trim()}`);
            }
        });

        kernel.stderr?.on('data', (data) => {
            for (const line of data.toString().split('\n')) {
                if (line.trim() && !line.includes('ExperimentalWarning')) {
                    console.log(`    ${C.RED}[KERNEL]${C.RESET} ${line.trim()}`);
                }
            }
        });

        kernel.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.log(`    ${C.RED}[KERNEL] Process exited with code ${code}${C.RESET}`);
            }
        });

        processes.push(kernel);

        // Wait for kernel to initialize
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!options.kernelOnly) {
        const uiProcess = spawn(npmCmd, ['run', 'dev'], {
            cwd: projectRoot,
            shell: true
        });

        uiProcess.stdout?.on('data', (data) => {
            for (const line of data.toString().split('\n')) {
                if (line.trim()) {
                    console.log(`    ${C.CYAN}[  UI  ]${C.RESET} ${line.trim()}`);
                }
            }
        });

        uiProcess.stderr?.on('data', (data) => {
            for (const line of data.toString().split('\n')) {
                if (line.trim() && !line.includes('ExperimentalWarning')) {
                    console.log(`    ${C.YELLOW}[  UI  ]${C.RESET} ${line.trim()}`);
                }
            }
        });

        processes.push(uiProcess);
    }

    console.log(`\n  ${C.GREEN}${C.BOLD}◆ Silhouette OS is awakening...${C.RESET}`);
    console.log(`  ${C.GRAY}Press Ctrl+C for graceful shutdown${C.RESET}\n`);

    // ── Graceful shutdown ────────────────────────────────────
    const shutdown = () => {
        console.log(`\n  ${C.YELLOW}${C.BOLD}◆ Shutting down gracefully...${C.RESET}`);
        for (const p of processes) {
            if (!p.killed) p.kill('SIGINT');
        }
        setTimeout(() => {
            console.log(`  ${C.GRAY}Forced exit.${C.RESET}\n`);
            process.exit(0);
        }, 3000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
