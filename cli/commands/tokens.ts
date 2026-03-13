// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — TOKENS COMMAND
// Token usage, costs, and budget tracking
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printTable, printCheck, isServerRunning, Spinner } from '../utils/ui';

interface TokensOptions {
    json?: boolean;
    reset?: boolean;
}

export async function tokensCommand(options: TokensOptions) {
    printCompactBanner();
    printSection('Token Usage & Costs', '🪙');

    if (!await isServerRunning()) {
        printCheck('fail', 'Server is not running');
        console.log(`    ${C.GRAY}Start with: ${C.WHITE}silhouette start${C.RESET}\n`);
        process.exit(1);
    }

    const spinner = new Spinner('Fetching telemetry data...');
    spinner.start();

    try {
        const res = await fetch('http://localhost:3005/v1/telemetry/stats', { signal: AbortSignal.timeout(5000) });
        const data = res.ok ? await res.json() as any : null;

        spinner.stop('Telemetry data retrieved', 'ok');

        if (options.json) {
            console.log(JSON.stringify(data, null, 2));
            return;
        }

        if (data) {
            // ── Token Summary ────────────────────────────────
            printSection('Usage Summary', '📊');

            const inputTokens = data.totalInputTokens || data.input_tokens || 0;
            const outputTokens = data.totalOutputTokens || data.output_tokens || 0;
            const totalTokens = inputTokens + outputTokens;
            const totalCost = data.totalCost || data.cost || 0;

            printTable(
                ['Metric', 'Value'],
                [
                    ['Input Tokens', formatNumber(inputTokens)],
                    ['Output Tokens', formatNumber(outputTokens)],
                    ['Total Tokens', formatNumber(totalTokens)],
                    ['Estimated Cost', `$${totalCost.toFixed(4)}`],
                    ['Requests', String(data.totalRequests || data.requests || '?')],
                ]
            );

            // ── Per-Provider Breakdown ───────────────────────
            if (data.perProvider || data.providers) {
                printSection('Per Provider', '🔌');
                const providers = data.perProvider || data.providers || {};
                const rows = Object.entries(providers).map(([name, stats]: [string, any]) => [
                    name,
                    formatNumber(stats.tokens || stats.totalTokens || 0),
                    `$${(stats.cost || stats.totalCost || 0).toFixed(4)}`,
                    String(stats.requests || stats.callCount || 0),
                ]);
                if (rows.length > 0) {
                    printTable(['Provider', 'Tokens', 'Cost', 'Requests'], rows);
                } else {
                    printCheck('warn', 'No per-provider data available yet');
                }
            }

            // ── Usage Bar ────────────────────────────────────
            if (totalTokens > 0) {
                const inputPct = Math.round((inputTokens / totalTokens) * 100);
                const barWidth = 30;
                const inputBar = Math.round(barWidth * inputPct / 100);
                console.log(`    Input/Output Ratio:`);
                console.log(`    ${C.CYAN}${'█'.repeat(inputBar)}${C.MAGENTA}${'█'.repeat(barWidth - inputBar)}${C.RESET}  ${C.CYAN}${inputPct}%${C.RESET} / ${C.MAGENTA}${100 - inputPct}%${C.RESET}\n`);
            }
        } else {
            printCheck('warn', 'No telemetry data available', 'Run some interactions first');
        }

    } catch (err: any) {
        spinner.stop('Failed to fetch telemetry', 'fail');
        printCheck('fail', err.message?.slice(0, 60));
    }
}

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
