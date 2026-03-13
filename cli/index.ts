#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — MAIN ENTRY POINT
// Premium command-line interface for Silhouette Agency OS
//
// Usage:
//   silhouette                    → Interactive mode selector
//   silhouette start              → Boot the full OS
//   silhouette setup              → Intelligent setup wizard
//   silhouette doctor             → System diagnostics (--fix)
//   silhouette restart            → Graceful restart (--force)
//   silhouette status             → Live service dashboard (--watch)
//   silhouette evolve [id]        → Evolve agents (--all)
//   silhouette brain              → Knowledge graph stats
//   silhouette memory             → 4-tier memory inspection
//   silhouette tokens             → Token usage & costs
//   silhouette squad              → Squad management (list, wake)
//   silhouette config             → Configuration management
//   silhouette optimizer          → Resource optimization
//   silhouette help [command]     → Comprehensive help
// ═══════════════════════════════════════════════════════════════

import { Command } from 'commander';
import { printBanner, printSmartRecommendations, isConfigured, isServerRunning, getVersion, C, printSection, printRecommendation } from './utils/ui';
import { loadConfig, validateConfig, saveConfig } from '../server/config/configSchema';

const program = new Command();

program
    .name('silhouette')
    .description('Silhouette Agency OS — Autonomous Agent Operating System')
    .version(getVersion(), '-v, --version', 'Display version and system info')
    .option('--quiet', 'Suppress non-essential output')
    .option('--verbose', 'Enable verbose debug output');

// ═══════════════════════════════════════════════════════════════
// PREMIUM COMMANDS (New)
// ═══════════════════════════════════════════════════════════════

// ─── silhouette start ────────────────────────────────────────
program
    .command('start')
    .description('Boot the Cognitive Kernel (backend + UI + daemon)')
    .option('--kernel-only', 'Start only the API backend (no UI)')
    .option('--ui-only', 'Start only the UI frontend')
    .option('-p, --port <port>', 'API port (default: 3005)')
    .action(async (options) => {
        const { startCommand } = await import('./commands/start');
        await startCommand(options);
    });

// ─── silhouette setup ────────────────────────────────────────
program
    .command('setup')
    .description('Launch the intelligent interactive setup wizard')
    .option('--reset', 'Wipe existing config and re-run full wizard')
    .option('--quick', 'Minimal setup (just LLM key + start)')
    .action(async (options) => {
        const { setupCommand } = await import('./commands/setup');
        await setupCommand(options);
    });

// ─── silhouette chat ─────────────────────────────────────────
program
    .command('chat')
    .description('Interactive terminal chat session with the Cognitive Kernel')
    .option('-s, --session <id>', 'Specific session ID to resume context')
    .action(async (options) => {
        const { chatCommand } = await import('./commands/chat');
        await chatCommand(options);
    });

// ─── silhouette doctor ───────────────────────────────────────
program
    .command('doctor')
    .description('Run comprehensive system diagnostics (6 categories)')
    .option('--fix', 'Auto-repair detected issues')
    .option('--security', 'Deep security audit (OWASP checks)')
    .action(async (options) => {
        const { doctorCommand } = await import('./commands/doctor');
        await doctorCommand(options);
    });

// ─── silhouette restart ──────────────────────────────────────
program
    .command('restart')
    .description('Graceful restart with automatic recovery')
    .option('-p, --port <port>', 'API port (default: 3005)')
    .option('--force', 'Force kill processes if graceful shutdown fails')
    .action(async (options) => {
        const { restartCommand } = await import('./commands/restart');
        await restartCommand(options);
    });

// ─── silhouette status ───────────────────────────────────────
program
    .command('status')
    .description('Live service dashboard with agent overview')
    .option('--json', 'Machine-readable JSON output')
    .option('--watch', 'Auto-refresh every 5 seconds')
    .action(async (options) => {
        const { statusCommand } = await import('./commands/status');
        await statusCommand(options);
    });

// ─── silhouette evolve ───────────────────────────────────────
program
    .command('evolve [agentId]')
    .description('Trigger evolution cycle for agents')
    .option('--all', 'Evolve all underperforming agents')
    .option('--dry-run', 'Preview what would happen without executing')
    .action(async (agentId, options) => {
        const { evolveCommand } = await import('./commands/evolve');
        await evolveCommand(agentId, options);
    });

// ─── silhouette brain ────────────────────────────────────────
program
    .command('brain')
    .description('Knowledge graph topology: σ index, concepts, bridges')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options) => {
        const { brainCommand } = await import('./commands/brain');
        await brainCommand(options);
    });

// ─── silhouette memory ───────────────────────────────────────
program
    .command('memory')
    .description('Inspect 4-tier memory system (Working → Short → Long → Deep)')
    .option('-t, --tier <tier>', 'Filter by tier (working, short, long, deep)')
    .option('-s, --search <query>', 'Semantic search across all memories')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options) => {
        const { memoryCommand } = await import('./commands/memory');
        await memoryCommand(options);
    });

// ─── silhouette tokens ──────────────────────────────────────
program
    .command('tokens')
    .description('Token usage, costs, and per-provider breakdown')
    .option('--json', 'Machine-readable JSON output')
    .option('--reset', 'Reset usage counters')
    .action(async (options) => {
        const { tokensCommand } = await import('./commands/tokens');
        await tokensCommand(options);
    });

// ═══════════════════════════════════════════════════════════════
// LEGACY COMMANDS (Preserved from original CLI)
// ═══════════════════════════════════════════════════════════════

// ─── silhouette squad ────────────────────────────────────────
program
    .command('squad [action] [id]')
    .description('Manage squads (list | wake <id>)')
    .action(async (action, id) => {
        const { printCompactBanner, printSection, printCheck } = await import('./utils/ui');
        printCompactBanner();

        if (!action || action === 'list') {
            try {
                const res = await fetch('http://localhost:3005/v1/squads');
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                const data: any = await res.json();
                if (data.success) {
                    printSection('Active Squads', '🛡️');
                    console.table(data.squads.map((s: any) => ({
                        ID: s.id, Name: s.name, Status: s.status,
                        Members: s.memberCount, Leader: s.leaderId
                    })));
                } else {
                    printCheck('fail', `Error: ${data.error}`);
                }
            } catch (e: any) {
                printCheck('fail', `Failed to fetch squads: ${e.message}`);
            }
        } else if (action === 'wake' && id) {
            try {
                const res = await fetch(`http://localhost:3005/v1/squads/${id}/wake`, { method: 'POST' });
                const data: any = await res.json();
                if (data.success) printCheck('ok', data.message);
                else printCheck('fail', data.error);
            } catch (e: any) {
                printCheck('fail', `Failed to wake squad: ${e.message}`);
            }
        } else {
            console.log(`    ${C.GRAY}Usage: silhouette squad list${C.RESET}`);
            console.log(`    ${C.GRAY}       silhouette squad wake <id>${C.RESET}\n`);
        }
    });

// ─── silhouette config ───────────────────────────────────────
program
    .command('config [action] [value]')
    .description('Configuration management (show | init | mode <lite|full>)')
    .action(async (action, value) => {
        const { printCompactBanner, printSection, printCheck } = await import('./utils/ui');
        printCompactBanner();

        if (action === 'init') {
            const config = loadConfig();
            saveConfig(config);
            printCheck('ok', 'silhouette.config.json created');
            console.log(`    ${C.GRAY}Edit it to customize. Secrets via .env.local${C.RESET}\n`);
        } else if (action === 'mode') {
            if (value !== 'lite' && value !== 'full') {
                console.log(`    ${C.GRAY}Usage: silhouette config mode <lite|full>${C.RESET}`);
                console.log(`    ${C.GRAY}  lite  : Optimized for <8GB RAM${C.RESET}`);
                console.log(`    ${C.GRAY}  full  : All systems enabled${C.RESET}\n`);
                return;
            }
            const config = loadConfig();
            if (value === 'lite') {
                config.modules = { graph: false, vectorDB: false, redis: false, browser: false };
                config.autonomy.maxConcurrentAgents = 3;
                config.autonomy.enableNarrative = false;
                config.autonomy.enableIntrospection = false;
                printCheck('ok', 'Switched to LITE mode');
            } else {
                config.modules = { graph: true, vectorDB: true, redis: true, browser: true };
                config.autonomy.maxConcurrentAgents = 10;
                config.autonomy.enableNarrative = true;
                config.autonomy.enableIntrospection = true;
                printCheck('ok', 'Switched to FULL mode');
            }
            saveConfig(config);
            console.log(`    ${C.GRAY}Restart to apply: ${C.WHITE}silhouette restart${C.RESET}\n`);
        } else {
            // Show config (redacted)
            const config = loadConfig();
            const display = JSON.parse(JSON.stringify(config));
            if (display.llm?.providers) {
                for (const p of Object.values(display.llm.providers) as any[]) {
                    if (p?.apiKey) p.apiKey = p.apiKey.slice(0, 8) + '...';
                }
            }
            printSection('Current Configuration', '⚙️');
            console.log(JSON.stringify(display, null, 2));
            console.log();
        }
    });

// ─── silhouette optimizer ────────────────────────────────────
program
    .command('optimizer')
    .description('Prune idle resources (--force to prune all)')
    .option('--force', 'Force prune all idle resources')
    .action(async (options) => {
        const { printCompactBanner, printCheck } = await import('./utils/ui');
        printCompactBanner();

        try {
            const port = process.env.PORT || 3005;
            const res = await fetch(`http://localhost:${port}/v1/system/optimize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: options.force })
            });
            if (res.ok) {
                const data: any = await res.json();
                printCheck('ok', data.message || 'Resources optimized');
            } else {
                printCheck('fail', `Server returned HTTP ${res.status}`);
            }
        } catch (e: any) {
            printCheck('fail', `Failed to connect: ${e.message}`);
        }
    });

// ═══════════════════════════════════════════════════════════════
// DEFAULT ACTION (no command specified)
// ═══════════════════════════════════════════════════════════════

program
    .action(async () => {
        printBanner();

        // Smart context detection
        const hasConfig = isConfigured();
        const isRunning = hasConfig ? await isServerRunning() : false;

        // Show available commands grouped by category
        printSection('Core Commands', '🚀');
        printRecommendation('start', 'Boot the Cognitive Kernel (backend + UI + daemon)');
        printRecommendation('chat', 'Interactive terminal session with the agent');
        printRecommendation('setup', 'Launch the intelligent interactive setup wizard');
        printRecommendation('restart', 'Graceful restart with automatic recovery (--force)');

        printSection('Inspection & Monitoring', '🔍');
        printRecommendation('status', 'Live service dashboard (--watch for auto-refresh)');
        printRecommendation('doctor', 'System diagnostics across 6 categories (--fix)');
        printRecommendation('brain', 'Knowledge graph: σ index, topology, bridges');
        printRecommendation('memory', 'Inspect 4-tier memory system (--search)');
        printRecommendation('tokens', 'Token usage, costs, per-provider breakdown');

        printSection('Evolution & Management', '🧬');
        printRecommendation('evolve', 'Trigger agent evolution (--all for batch)');
        printRecommendation('squad', 'Manage agent squads (list, wake)');
        printRecommendation('config', 'Configuration (show, init, mode <lite|full>)');
        printRecommendation('optimizer', 'Prune idle resources');

        // Smart recommendations based on current state
        printSmartRecommendations({
            hasConfig,
            isRunning,
            hasDiagnosticIssues: !hasConfig,
        });
    });

// ─── Parse ───────────────────────────────────────────────────
program.parseAsync(process.argv)
    .then(() => {
        // Force exit to prevent hanging on open handles from API checks
        if (!process.argv.includes('status') && !process.argv.includes('--watch')) {
            setTimeout(() => process.exit(0), 100);
        }
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
