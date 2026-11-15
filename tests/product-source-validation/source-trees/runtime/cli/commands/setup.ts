// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — SETUP COMMAND
// Delegates to existing intelligent setup wizard
// ═══════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import { C, printCompactBanner, printSection, getProjectRoot } from '../utils/ui';

interface SetupOptions {
    reset?: boolean;
    quick?: boolean;
}

export async function setupCommand(options: SetupOptions) {
    printCompactBanner();
    printSection('Intelligent Setup Wizard', '🧙');

    const projectRoot = getProjectRoot();
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';

    if (options.reset) {
        const fs = await import('fs');
        const path = await import('path');
        const envPath = path.join(projectRoot, '.env.local');
        const configPath = path.join(projectRoot, 'silhouette.config.json');

        if (fs.existsSync(envPath)) {
            fs.unlinkSync(envPath);
            console.log(`    ${C.YELLOW}⚠${C.RESET}  Removed .env.local`);
        }
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
            console.log(`    ${C.YELLOW}⚠${C.RESET}  Removed silhouette.config.json`);
        }
        console.log();
    }

    console.log(`    ${C.GRAY}Launching interactive configuration wizard...${C.RESET}\n`);

    // Delegate to the full 753-line setup wizard
    const setup = spawn(npmCmd, ['run', 'setup:intelligent'], {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: true,
    });

    setup.on('close', (code) => {
        if (code === 0) {
            console.log(`\n  ${C.GREEN}${C.BOLD}◆ Setup complete!${C.RESET}`);
            console.log(`  ${C.GRAY}Next: ${C.WHITE}silhouette start${C.RESET}\n`);
        } else {
            console.log(`\n  ${C.RED}Setup exited with code ${code}${C.RESET}\n`);
        }
    });
}
