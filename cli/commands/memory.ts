// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — MEMORY COMMAND
// 4-tier memory inspection: Working → Short → Long → Deep
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printTable, printCheck, isServerRunning, Spinner } from '../utils/ui';

interface MemoryOptions {
    tier?: string;
    search?: string;
    json?: boolean;
}

export async function memoryCommand(options: MemoryOptions) {
    printCompactBanner();
    printSection('Continuum Memory System', '💾');

    if (!await isServerRunning()) {
        printCheck('fail', 'Server is not running');
        console.log(`    ${C.GRAY}Start with: ${C.WHITE}silhouette start${C.RESET}\n`);
        process.exit(1);
    }

    const spinner = new Spinner('Reading memory banks...');
    spinner.start();

    try {
        // Fetch memory stats
        const statsRes = await fetch('http://localhost:3005/v1/memory/stats', { signal: AbortSignal.timeout(5000) });
        const stats = statsRes.ok ? await statsRes.json() as any : null;

        spinner.stop('Memory banks accessed', 'ok');

        if (options.json) {
            console.log(JSON.stringify(stats, null, 2));
            return;
        }

        if (stats) {
            // ── Tier Overview ────────────────────────────────
            printSection('Memory Tiers', '📊');

            const tiers = [
                ['WORKING', String(stats.working || 0), 'Active context, current session', '~30 min TTL'],
                ['SHORT-TERM', String(stats.shortTerm || 0), 'Recent interactions', '~24 hours TTL'],
                ['LONG-TERM', String(stats.longTerm || 0), 'Consolidated knowledge', 'Persistent'],
                ['DEEP', String(stats.deep || 0), 'Core identity & skills', 'Permanent'],
            ];

            printTable(['Tier', 'Entries', 'Purpose', 'Retention'], tiers);

            // ── Total ────────────────────────────────────────
            const total = (stats.working || 0) + (stats.shortTerm || 0) + (stats.longTerm || 0) + (stats.deep || 0);
            console.log(`    ${C.BOLD}Total Memories:${C.RESET}  ${C.CYAN}${total}${C.RESET}\n`);

            // Visual memory distribution bar
            if (total > 0) {
                const barWidth = 40;
                const wBar = Math.round((stats.working || 0) / total * barWidth);
                const sBar = Math.round((stats.shortTerm || 0) / total * barWidth);
                const lBar = Math.round((stats.longTerm || 0) / total * barWidth);
                const dBar = barWidth - wBar - sBar - lBar;

                console.log(`    Distribution:`);
                console.log(`    ${C.YELLOW}${'█'.repeat(wBar)}${C.CYAN}${'█'.repeat(sBar)}${C.GREEN}${'█'.repeat(lBar)}${C.MAGENTA}${'█'.repeat(Math.max(0, dBar))}${C.RESET}`);
                console.log(`    ${C.YELLOW}Working${C.RESET} ${C.CYAN}Short${C.RESET} ${C.GREEN}Long${C.RESET} ${C.MAGENTA}Deep${C.RESET}\n`);
            }
        }

        // ── Search Mode ──────────────────────────────────────
        if (options.search) {
            printSection('Semantic Search', '🔍');
            const searchSpinner = new Spinner(`Searching: "${options.search}"`);
            searchSpinner.start();

            try {
                const searchRes = await fetch(`http://localhost:3005/v1/memory/search?q=${encodeURIComponent(options.search)}&limit=5`, {
                    signal: AbortSignal.timeout(10000)
                });
                const results = searchRes.ok ? await searchRes.json() as any : [];
                const entries = Array.isArray(results) ? results : results?.results || [];
                searchSpinner.stop(`Found ${entries.length} memories`, 'ok');

                if (entries.length > 0) {
                    for (const entry of entries.slice(0, 5)) {
                        const content = (entry.content || entry.text || '').slice(0, 100);
                        const similarity = entry.similarity ? ` (${(entry.similarity * 100).toFixed(0)}%)` : '';
                        const tier = entry.tier || entry.memoryTier || '';
                        console.log(`    ${C.CYAN}●${C.RESET}  ${C.DIM}[${tier}]${C.RESET} ${content}${C.GRAY}${similarity}${C.RESET}`);
                    }
                    console.log();
                } else {
                    printCheck('warn', 'No memories found for this query');
                }
            } catch {
                searchSpinner.stop('Search failed', 'fail');
            }
        }

    } catch (err: any) {
        spinner.stop('Failed to read memory', 'fail');
        printCheck('fail', err.message?.slice(0, 60));
    }
}
