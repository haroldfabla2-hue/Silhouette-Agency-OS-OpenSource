// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — RESTART COMMAND
// Graceful restart with automatic recovery
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printCheck, isServerRunning, getProjectRoot, Spinner } from '../utils/ui';
import { startCommand } from './start';

interface RestartOptions {
    port?: string;
    force?: boolean;
}

export async function restartCommand(options: RestartOptions) {
    printCompactBanner();
    printSection('Restarting Silhouette OS', '🔄');

    const port = parseInt(options.port || '3005');
    const running = await isServerRunning(port);

    if (running) {
        const spinner = new Spinner('Sending shutdown signal...');
        spinner.start();

        try {
            // Send graceful shutdown signal via API
            await fetch(`http://localhost:${port}/v1/system/shutdown`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(5000)
            }).catch(() => {});

            // Wait for server to stop
            let attempts = 0;
            while (attempts < 15) {
                await new Promise(r => setTimeout(r, 1000));
                const stillRunning = await isServerRunning(port);
                if (!stillRunning) break;
                attempts++;
            }

            const stillUp = await isServerRunning(port);
            if (stillUp && options.force) {
                spinner.stop('Graceful shutdown timed out, force killing...', 'warn');
                // Force kill via taskkill (Windows) or kill (Unix)
                try {
                    if (process.platform === 'win32') {
                        const { execSync } = await import('child_process');
                        execSync(`cmd.exe /c "FOR /F "tokens=5" %a IN ('netstat -ano ^| findstr :${port}') DO taskkill /PID %a /F"`, { stdio: 'pipe' });
                    } else {
                        const { execSync } = await import('child_process');
                        execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'pipe' });
                    }
                } catch { /* port may already be free */ }
            } else if (stillUp) {
                spinner.stop('Server still running. Try: silhouette restart --force', 'fail');
                process.exit(1);
            } else {
                spinner.stop('Server stopped successfully', 'ok');
            }
        } catch (err: any) {
            spinner.stop('Shutdown signal sent', 'warn');
        }

        // Wait a beat for ports to release
        await new Promise(r => setTimeout(r, 2000));
    } else {
        printCheck('warn', `Server not running on port ${port}`, 'Starting fresh...');
    }

    // Start fresh
    console.log(`\n  ${C.CYAN}${C.BOLD}◆ Rebooting...${C.RESET}\n`);
    await startCommand({ port: String(port) });
}
