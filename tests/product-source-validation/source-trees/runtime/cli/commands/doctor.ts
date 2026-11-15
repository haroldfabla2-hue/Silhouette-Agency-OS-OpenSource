// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — DOCTOR COMMAND
// Comprehensive system diagnostics across 6 categories
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import fs from 'fs';
import { C, printCompactBanner, printSection, printCheck, getProjectRoot, Spinner } from '../utils/ui';
import { runAllChecks, CheckResult } from '../utils/checks';

interface DoctorOptions {
    fix?: boolean;
    security?: boolean;
}

export async function doctorCommand(options: DoctorOptions) {
    printCompactBanner();
    printSection('System Diagnostics', '🩺');

    const projectRoot = getProjectRoot();
    const spinner = new Spinner('Running diagnostic checks...');
    spinner.start();

    const results = await runAllChecks(projectRoot);
    spinner.stop('Diagnostic scan complete', 'ok');

    // ── Display Results ──────────────────────────────────────
    const categories: [string, string, CheckResult[]][] = [
        ['Runtime Environment', '⚙️', results.runtime],
        ['Infrastructure', '🏗️', results.infrastructure],
        ['Configuration', '📋', results.configuration],
        ['Security', '🔒', results.security],
        ['Connectivity', '🌐', results.connectivity],
        ['Autonomy Systems', '🧬', results.autonomy],
    ];

    let totalOk = 0, totalWarn = 0, totalFail = 0;
    const fixable: CheckResult[] = [];

    for (const [name, icon, checks] of categories) {
        printSection(name, icon);
        for (const check of checks) {
            printCheck(check.status, check.message, check.detail);
            if (check.status === 'ok') totalOk++;
            else if (check.status === 'warn') totalWarn++;
            else if (check.status === 'fail') totalFail++;
            if (check.fixable && (check.status === 'warn' || check.status === 'fail')) {
                fixable.push(check);
            }
        }
    }

    // ── Summary ──────────────────────────────────────────────
    console.log();
    printSection('Summary', '📊');

    const total = totalOk + totalWarn + totalFail;
    const healthPercent = total > 0 ? Math.round((totalOk / total) * 100) : 0;
    const healthBar = generateHealthBar(healthPercent);

    console.log(`    ${C.BOLD}System Health:${C.RESET}  ${healthBar}  ${healthPercent}%`);
    console.log(`    ${C.GREEN}${totalOk} passed${C.RESET}  ${C.YELLOW}${totalWarn} warnings${C.RESET}  ${C.RED}${totalFail} failures${C.RESET}`);
    console.log();

    // ── Auto-fix Mode ────────────────────────────────────────
    if (options.fix && fixable.length > 0) {
        printSection('Auto-Repair', '🔧');
        for (const check of fixable) {
            if (check.fixCommand) {
                console.log(`    ${C.CYAN}→${C.RESET}  Fixing: ${check.name}`);
                console.log(`      ${C.GRAY}$ ${check.fixCommand}${C.RESET}`);
                try {
                    if (check.fixCommand.startsWith('silhouette')) {
                        console.log(`      ${C.YELLOW}↳ Run manually: ${check.fixCommand}${C.RESET}`);
                    } else if (check.fixCommand.startsWith('mkdir')) {
                        const dir = check.fixCommand.replace('mkdir "', '').replace('"', '');
                        fs.mkdirSync(dir, { recursive: true });
                        printCheck('ok', `Created ${dir}`);
                    } else if (check.fixCommand.startsWith('docker')) {
                        execSync(check.fixCommand, { stdio: 'pipe', timeout: 30000 });
                        printCheck('ok', `Started container for ${check.name}`);
                    }
                } catch (err: any) {
                    printCheck('fail', `Auto-fix failed: ${err.message?.slice(0, 60)}`);
                }
            }
        }
        console.log();
    } else if (fixable.length > 0 && !options.fix) {
        console.log(`    ${C.YELLOW}${fixable.length} issue(s) can be auto-repaired.${C.RESET}`);
        console.log(`    ${C.GRAY}Run: ${C.WHITE}${C.BOLD}silhouette doctor --fix${C.RESET}\n`);
    }

    // ── Recommendations ──────────────────────────────────────
    if (totalFail > 0) {
        printSection('Critical Issues', '🚨');
        for (const [, , checks] of categories) {
            for (const check of checks) {
                if (check.status === 'fail') {
                    console.log(`    ${C.RED}✗${C.RESET}  ${C.BOLD}${check.name}${C.RESET}: ${check.detail || check.message}`);
                    if (check.fixCommand) {
                        console.log(`      ${C.GRAY}Fix: ${C.CYAN}${check.fixCommand}${C.RESET}`);
                    }
                }
            }
        }
        console.log();
    }

    if (healthPercent === 100) {
        console.log(`    ${C.GREEN}${C.BOLD}◆ All systems nominal. Silhouette OS is production-ready.${C.RESET}\n`);
    }

    process.exit(totalFail > 0 ? 1 : 0);
}

function generateHealthBar(percent: number): string {
    const width = 20;
    const filled = Math.round(width * percent / 100);
    const empty = width - filled;
    const color = percent >= 80 ? C.GREEN : percent >= 50 ? C.YELLOW : C.RED;
    return `${color}${'█'.repeat(filled)}${C.GRAY}${'░'.repeat(empty)}${C.RESET}`;
}
