
/**
 * JANUS: The Two-Faced Guardian (Supervisor)
 * 
 * Purpose: 
 * 1. Runs the Silhouette Server.
 * 2. Watches for exit codes.
 * 3. Restarts the system automatically if the Agent updates its own code.
 * 
 * Usage: node scripts/janus.js
 */

import { spawn } from 'child_process';
import path from 'path';

const MAX_RESTARTS = 10;
const RESTART_WINDOW_MS = 60000; // 1 minute

let restartCount = 0;
let lastRestartTime = Date.now();

function startServer() {
    console.log('\n[JANUS] 🎭 Summoning Silhouette OS...');

    // Command: npm run server
    // We use 'npm.cmd' on Windows, 'npm' on Unix
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    const server = spawn(npmCmd, ['run', 'server'], {
        stdio: 'inherit', // Pipe logs directly to terminal
        shell: true,
        env: { ...process.env, JANUS_ACTIVE: 'true' }
    });

    server.on('close', (code) => {
        const now = Date.now();
        console.log(`[JANUS] 🛑 Server exited with code: ${code}`);

        // Reset counter if enough time passed
        if (now - lastRestartTime > RESTART_WINDOW_MS) {
            restartCount = 0;
        }
        lastRestartTime = now;

        // Logic
        if (code === 0) {
            console.log('[JANUS] ✅ Clean Exit (Self-Update or Stop). Restarting immediately...');
            restartCount = 0; // Intentional restarts don't count against limit
            startServer();
        } else {
            console.log('[JANUS] ⚠️ Crash Detected.');
            restartCount++;

            if (restartCount >= MAX_RESTARTS) {
                console.error('[JANUS] 💥 Too many crashes. Giving up.');
                process.exit(1);
            } else {
                console.log(`[JANUS] 🩹 Auto-Healing (Attempt ${restartCount}/${MAX_RESTARTS})...`);
                setTimeout(startServer, 1000); // Wait 1s before restart
            }
        }
    });

    server.on('error', (err) => {
        console.error('[JANUS] Failed to spawn server:', err);
    });
}

// Start
console.log('[JANUS] 🏛️ Supervisor Active. Protecting the core.');
startServer();
