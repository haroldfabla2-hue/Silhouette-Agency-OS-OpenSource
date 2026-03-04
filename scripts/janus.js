
/**
 * JANUS V2: The Two-Faced Guardian (Intelligent Supervisor)
 * 
 * Purpose: 
 * 1. Runs the Silhouette Server.
 * 2. Watches for exit codes and captures crash output.
 * 3. Analyzes crash patterns and applies exponential backoff.
 * 4. Writes diagnostic crash reports for LearningLoop ingestion.
 * 5. On repeated crashes (3+ same signature), invokes janus_repair for LLM analysis.
 * 
 * Usage: node scripts/janus.js
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MAX_RESTARTS = 10;
const RESTART_WINDOW_MS = 120000; // 2 minutes
const CRASH_LOG_DIR = path.join(process.cwd(), 'logs');
const CRASH_REPORT_PATH = path.join(CRASH_LOG_DIR, 'janus_crash_report.txt');
const CRASH_HISTORY_PATH = path.join(CRASH_LOG_DIR, 'janus_crash_history.json');
const REPAIR_THRESHOLD = 3; // Same crash 3x triggers repair
const MAX_REPAIRS_PER_SIGNATURE = 3; // Circuit breaker: max total repair attempts per unique crash
const REPAIR_COOLDOWN_MS = 300000;   // 5 minute cooldown between repairs

let restartCount = 0;
let lastRestartTime = Date.now();
let stderrBuffer = '';

// ══════════════════════════════════════════════════════════════
// CRASH SIGNATURE TRACKING
// ══════════════════════════════════════════════════════════════

function loadCrashHistory() {
    try {
        return JSON.parse(fs.readFileSync(CRASH_HISTORY_PATH, 'utf-8'));
    } catch {
        return { signatures: {}, totalCrashes: 0, lastRepairAt: 0 };
    }
}

function saveCrashHistory(history) {
    try {
        fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
        fs.writeFileSync(CRASH_HISTORY_PATH, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('[JANUS] Failed to save crash history:', e.message);
    }
}

function computeCrashSignature(stderr) {
    // Extract the first meaningful error line (stack trace root)
    const lines = stderr.split('\n').filter(l => l.trim());
    const errorLine = lines.find(l =>
        l.includes('Error:') || l.includes('TypeError:') ||
        l.includes('ReferenceError:') || l.includes('SyntaxError:') ||
        l.includes('FATAL') || l.includes('EADDRINUSE') || l.includes('ENOENT')
    ) || lines[0] || 'unknown';

    return crypto.createHash('md5').update(errorLine.trim()).digest('hex').substring(0, 12);
}

function writeCrashReport(exitCode, stderr) {
    try {
        fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
        const report = [
            `═══ JANUS CRASH REPORT ═══`,
            `Timestamp: ${new Date().toISOString()}`,
            `Exit Code: ${exitCode}`,
            `Restart Count: ${restartCount}/${MAX_RESTARTS}`,
            `Crash Signature: ${computeCrashSignature(stderr)}`,
            ``,
            `═══ STDERR (last 200 lines) ═══`,
            stderr.split('\n').slice(-200).join('\n'),
            ``,
            `═══ END REPORT ═══`
        ].join('\n');

        fs.writeFileSync(CRASH_REPORT_PATH, report);
        console.log(`[JANUS] 📝 Crash report written to ${CRASH_REPORT_PATH}`);
    } catch (e) {
        console.error('[JANUS] Failed to write crash report:', e.message);
    }
}

// ══════════════════════════════════════════════════════════════
// REPAIR INVOCATION
// ══════════════════════════════════════════════════════════════

function attemptRepair(signature, attemptNumber) {
    console.log(`[JANUS] 🧬 Crash signature ${signature} repeated ${REPAIR_THRESHOLD}+ times. Invoking deep repair (attempt ${attemptNumber || 1})...`);
    try {
        // Try to invoke janus_repair.ts via tsx
        const npmCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        execSync(`${npmCmd} tsx scripts/janus_repair.ts`, {
            stdio: 'inherit',
            timeout: 120000, // 120s max for deep brain diagnosis
            env: {
                ...process.env,
                JANUS_CRASH_SIGNATURE: signature,
                JANUS_REPAIR_ATTEMPT: String(attemptNumber || 1)
            }
        });
        console.log('[JANUS] 🔧 Repair script completed.');
        return true;
    } catch (e) {
        console.error('[JANUS] Repair script failed:', e.message);
        return false;
    }
}

// ══════════════════════════════════════════════════════════════
// EXPONENTIAL BACKOFF
// ══════════════════════════════════════════════════════════════

function getBackoffDelay(attempt) {
    // 1s, 2s, 4s, 8s, 16s, capped at 30s
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
}

// ══════════════════════════════════════════════════════════════
// MAIN SERVER LOOP
// ══════════════════════════════════════════════════════════════

function startServer() {
    console.log('\n[JANUS] 🎭 Summoning Silhouette OS...');
    stderrBuffer = '';

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    const server = spawn(npmCmd, ['run', 'server'], {
        stdio: ['inherit', 'inherit', 'pipe'], // Capture stderr, pass stdout
        shell: true,
        env: { ...process.env, JANUS_ACTIVE: 'true' }
    });

    // Capture stderr for crash analysis
    server.stderr.on('data', (data) => {
        const text = data.toString();
        process.stderr.write(text); // Still show in terminal
        stderrBuffer += text;
        // Keep buffer manageable (last 50KB)
        if (stderrBuffer.length > 50000) {
            stderrBuffer = stderrBuffer.slice(-50000);
        }
    });

    server.on('close', (code) => {
        const now = Date.now();
        console.log(`[JANUS] 🛑 Server exited with code: ${code}`);

        // Reset counter if enough time passed (system was stable)
        if (now - lastRestartTime > RESTART_WINDOW_MS) {
            restartCount = 0;
        }
        lastRestartTime = now;

        if (code === 0) {
            // Clean exit (self-update or intentional stop)
            console.log('[JANUS] ✅ Clean Exit (Self-Update or Stop). Restarting immediately...');
            restartCount = 0;
            startServer();
        } else {
            // CRASH — analyze and decide
            console.log('[JANUS] ⚠️ Crash Detected. Analyzing...');
            restartCount++;

            // Write crash report
            writeCrashReport(code, stderrBuffer);

            // Track crash signature
            const signature = computeCrashSignature(stderrBuffer);
            const history = loadCrashHistory();
            history.totalCrashes++;
            history.signatures[signature] = (history.signatures[signature] || 0) + 1;
            saveCrashHistory(history);

            console.log(`[JANUS] 🔍 Crash signature: ${signature} (seen ${history.signatures[signature]}x)`);

            // Check if repair should be attempted
            if (history.signatures[signature] >= REPAIR_THRESHOLD) {
                // Circuit Breaker: check total repair attempts for this signature
                const repairCount = history.repairAttempts?.[signature] || 0;
                const now = Date.now();

                if (repairCount >= MAX_REPAIRS_PER_SIGNATURE) {
                    console.error(`[JANUS] 🔒 CIRCUIT BREAKER: Signature ${signature} has exhausted ${MAX_REPAIRS_PER_SIGNATURE} repair attempts.`);
                    console.error('[JANUS] 🧑‍💻 HUMAN ESCALATION REQUIRED. Review: logs/janus_crash_report.txt');
                    console.error('[JANUS] 📋 Repair history:', JSON.stringify(history.repairAttempts, null, 2));
                    // Do NOT attempt repair — force human review
                } else if (history.lastRepairAt && (now - history.lastRepairAt < REPAIR_COOLDOWN_MS)) {
                    const remainingSec = Math.ceil((REPAIR_COOLDOWN_MS - (now - history.lastRepairAt)) / 1000);
                    console.warn(`[JANUS] ⏳ Repair cooldown active. Next repair available in ${remainingSec}s`);
                } else {
                    const repaired = attemptRepair(signature, repairCount + 1);
                    // Track repair attempt (independently from crash count)
                    history.repairAttempts = history.repairAttempts || {};
                    history.repairAttempts[signature] = repairCount + 1;
                    history.lastRepairAt = now;
                    if (repaired) {
                        // Reset crash signature count to track NEW crashes post-repair
                        history.signatures[signature] = 0;
                    }
                    saveCrashHistory(history);
                    console.log(`[JANUS] 🔧 Repair attempt ${repairCount + 1}/${MAX_REPAIRS_PER_SIGNATURE} for signature ${signature}`);
                }
            }

            if (restartCount >= MAX_RESTARTS) {
                console.error('[JANUS] 💥 Too many crashes in rapid succession. Going dormant.');
                console.error(`[JANUS] Total historical crashes: ${history.totalCrashes}`);
                console.error('[JANUS] Review: logs/janus_crash_report.txt');
                process.exit(1);
            } else {
                const delay = getBackoffDelay(restartCount);
                console.log(`[JANUS] 🩹 Auto-Healing (Attempt ${restartCount}/${MAX_RESTARTS}). Backoff: ${delay}ms...`);
                setTimeout(startServer, delay);
            }
        }
    });

    server.on('error', (err) => {
        console.error('[JANUS] Failed to spawn server:', err);
    });
}

// Start
console.log('[JANUS] 🏛️ Supervisor V2 Active. Intelligent crash analysis enabled.');
console.log(`[JANUS] Repair threshold: ${REPAIR_THRESHOLD} repeated crashes`);
startServer();
