// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — UI UTILITIES
// Premium terminal output: banners, tables, statuses, spinners
// Zero external dependencies — pure ANSI escape sequences
// ═══════════════════════════════════════════════════════════════

import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── ANSI Color Constants ────────────────────────────────────
export const C = {
    RESET:   '\x1b[0m',
    BOLD:    '\x1b[1m',
    DIM:     '\x1b[2m',
    ITALIC:  '\x1b[3m',
    UNDER:   '\x1b[4m',
    // Colors
    RED:     '\x1b[31m',
    GREEN:   '\x1b[32m',
    YELLOW:  '\x1b[33m',
    BLUE:    '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN:    '\x1b[36m',
    WHITE:   '\x1b[37m',
    GRAY:    '\x1b[90m',
    // Bright
    B_RED:   '\x1b[91m',
    B_GREEN: '\x1b[92m',
    B_CYAN:  '\x1b[96m',
    B_WHITE: '\x1b[97m',
    // Background
    BG_RED:     '\x1b[41m',
    BG_GREEN:   '\x1b[42m',
    BG_YELLOW:  '\x1b[43m',
    BG_BLUE:    '\x1b[44m',
    BG_MAGENTA: '\x1b[45m',
    BG_CYAN:    '\x1b[46m',
} as const;

// ─── Get Version ─────────────────────────────────────────────
export function getVersion(): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

// ─── Premium ASCII Banner ────────────────────────────────────
export function printBanner() {
    const v = getVersion();
    const nodeV = process.version;
    const platform = `${os.platform()}-${os.arch()}`;
    const ram = `${Math.round(os.totalmem() / (1024 ** 3))}GB`;

    console.log(`
${C.CYAN}${C.BOLD}  ███████╗██╗██╗     ██╗  ██╗ ██████╗ ██╗   ██╗███████╗████████╗████████╗███████╗${C.RESET}
${C.CYAN}  ██╔════╝██║██║     ██║  ██║██╔═══██╗██║   ██║██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝${C.RESET}
${C.B_CYAN}  ███████╗██║██║     ███████║██║   ██║██║   ██║█████╗     ██║      ██║   █████╗  ${C.RESET}
${C.CYAN}  ╚════██║██║██║     ██╔══██║██║   ██║██║   ██║██╔══╝     ██║      ██║   ██╔══╝  ${C.RESET}
${C.CYAN}${C.BOLD}  ███████║██║███████╗██║  ██║╚██████╔╝╚██████╔╝███████╗   ██║      ██║   ███████╗${C.RESET}
${C.CYAN}  ╚══════╝╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝      ╚═╝   ╚══════╝${C.RESET}
${C.GRAY}  ──────────────────────────────────────────────────────────────────────────────────${C.RESET}
${C.DIM}  Autonomous Agent Operating System${C.RESET}    ${C.MAGENTA}v${v}${C.RESET}  ${C.GRAY}│${C.RESET}  ${C.DIM}Node ${nodeV}${C.RESET}  ${C.GRAY}│${C.RESET}  ${C.DIM}${platform}${C.RESET}  ${C.GRAY}│${C.RESET}  ${C.DIM}${ram} RAM${C.RESET}
${C.GRAY}  ──────────────────────────────────────────────────────────────────────────────────${C.RESET}
`);
}

// ─── Compact Banner (for subcommands) ───────────────────────
export function printCompactBanner() {
    const v = getVersion();
    console.log(`\n${C.CYAN}${C.BOLD}  ◆ SILHOUETTE OS${C.RESET} ${C.GRAY}v${v}${C.RESET}\n`);
}

// ─── Status Icons ────────────────────────────────────────────
export const STATUS = {
    OK:      `${C.GREEN}✓${C.RESET}`,
    WARN:    `${C.YELLOW}⚠${C.RESET}`,
    FAIL:    `${C.RED}✗${C.RESET}`,
    INFO:    `${C.BLUE}ℹ${C.RESET}`,
    SKIP:    `${C.GRAY}○${C.RESET}`,
    SPIN:    `${C.CYAN}◌${C.RESET}`,
    ARROW:   `${C.CYAN}→${C.RESET}`,
    DOT:     `${C.GRAY}·${C.RESET}`,
} as const;

// ─── Print Section Header ────────────────────────────────────
export function printSection(title: string, icon: string = '◆') {
    console.log(`\n  ${C.CYAN}${C.BOLD}${icon} ${title}${C.RESET}`);
    console.log(`  ${C.GRAY}${'─'.repeat(title.length + 2)}${C.RESET}\n`);
}

// ─── Print Diagnostic Check ─────────────────────────────────
export function printCheck(status: 'ok' | 'warn' | 'fail' | 'skip', message: string, detail?: string) {
    const icon = status === 'ok' ? STATUS.OK : status === 'warn' ? STATUS.WARN : status === 'fail' ? STATUS.FAIL : STATUS.SKIP;
    const color = status === 'ok' ? C.GREEN : status === 'warn' ? C.YELLOW : status === 'fail' ? C.RED : C.GRAY;
    console.log(`    ${icon}  ${color}${message}${C.RESET}${detail ? `  ${C.GRAY}${detail}${C.RESET}` : ''}`);
}

// ─── Print Table ─────────────────────────────────────────────
export function printTable(headers: string[], rows: string[][]) {
    const colWidths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map(r => (r[i] || '').length)) + 2
    );

    // Header
    const headerLine = headers.map((h, i) =>
        `${C.BOLD}${C.CYAN}${h.padEnd(colWidths[i])}${C.RESET}`
    ).join('  ');
    console.log(`    ${headerLine}`);
    console.log(`    ${C.GRAY}${colWidths.map(w => '─'.repeat(w)).join('──')}${C.RESET}`);

    // Rows
    for (const row of rows) {
        const rowLine = row.map((cell, i) => {
            // Color-code status cells
            let colored = cell;
            if (cell === 'ONLINE' || cell === 'OK' || cell === 'ACTIVE') colored = `${C.GREEN}${cell}${C.RESET}`;
            else if (cell === 'OFFLINE' || cell === 'ERROR' || cell === 'DOWN') colored = `${C.RED}${cell}${C.RESET}`;
            else if (cell === 'DEGRADED' || cell === 'WARN') colored = `${C.YELLOW}${cell}${C.RESET}`;
            else if (cell === 'UNKNOWN' || cell === 'SKIP') colored = `${C.GRAY}${cell}${C.RESET}`;
            return colored.padEnd(colWidths[i] + (colored.length - cell.length));
        }).join('  ');
        console.log(`    ${rowLine}`);
    }
    console.log();
}

// ─── Print Recommendation ────────────────────────────────────
export function printRecommendation(command: string, description: string) {
    console.log(`    ${C.CYAN}${C.BOLD}→${C.RESET}  ${C.WHITE}silhouette ${command}${C.RESET}  ${C.GRAY}— ${description}${C.RESET}`);
}

// ─── Print Smart Recommendations ─────────────────────────────
export function printSmartRecommendations(context: {
    hasConfig?: boolean;
    isRunning?: boolean;
    hasDiagnosticIssues?: boolean;
    agentCount?: number;
}) {
    printSection('Suggested Next Steps', '💡');

    if (!context.hasConfig) {
        printRecommendation('setup', 'Run the intelligent setup wizard to configure your OS');
        return;
    }

    if (context.hasDiagnosticIssues) {
        printRecommendation('doctor --fix', 'Auto-repair detected issues');
    }

    if (!context.isRunning) {
        printRecommendation('start', 'Boot the Cognitive Kernel');
    } else {
        printRecommendation('status --watch', 'Monitor live service health');
        if ((context.agentCount || 0) > 0) {
            printRecommendation('evolve --all', 'Evolve underperforming agents');
        }
    }

    printRecommendation('doctor', 'Run full system diagnostics');
    console.log();
}

// ─── Animated Spinner ────────────────────────────────────────
export class Spinner {
    private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private interval: NodeJS.Timeout | null = null;
    private frameIdx = 0;
    private message: string;

    constructor(message: string) {
        this.message = message;
    }

    start() {
        process.stdout.write(`    ${C.CYAN}${this.frames[0]}${C.RESET} ${this.message}`);
        this.interval = setInterval(() => {
            this.frameIdx = (this.frameIdx + 1) % this.frames.length;
            process.stdout.write(`\r    ${C.CYAN}${this.frames[this.frameIdx]}${C.RESET} ${this.message}`);
        }, 80);
    }

    stop(finalMessage?: string, status: 'ok' | 'fail' | 'warn' = 'ok') {
        if (this.interval) clearInterval(this.interval);
        const icon = status === 'ok' ? STATUS.OK : status === 'fail' ? STATUS.FAIL : STATUS.WARN;
        process.stdout.write(`\r    ${icon}  ${finalMessage || this.message}\n`);
    }
}

// ─── Check if Silhouette is configured ───────────────────────
export function isConfigured(): boolean {
    const projectRoot = path.resolve(__dirname, '../..');
    return fs.existsSync(path.join(projectRoot, '.env.local')) ||
           fs.existsSync(path.join(projectRoot, 'silhouette.config.json'));
}

// ─── Check if Server is Running ──────────────────────────────
export async function isServerRunning(port: number = 3005): Promise<boolean> {
    try {
        const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
        return response.ok;
    } catch {
        return false;
    }
}

// ─── Project Root ────────────────────────────────────────────
export function getProjectRoot(): string {
    return path.resolve(__dirname, '../..');
}
