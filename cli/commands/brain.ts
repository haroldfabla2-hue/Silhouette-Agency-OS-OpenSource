// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — BRAIN COMMAND
// Knowledge Graph stats: σ index, concepts, bridges, topology
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printCheck, printTable, isServerRunning, Spinner } from '../utils/ui';

interface BrainOptions {
    json?: boolean;
}

export async function brainCommand(options: BrainOptions) {
    printCompactBanner();
    printSection('Knowledge Graph — Brain', '🧠');

    if (!await isServerRunning()) {
        printCheck('fail', 'Server is not running');
        console.log(`    ${C.GRAY}Start with: ${C.WHITE}silhouette start${C.RESET}\n`);
        process.exit(1);
    }

    const spinner = new Spinner('Querying knowledge graph...');
    spinner.start();

    try {
        // Fetch topology report
        const topoRes = await fetch('http://localhost:3005/v1/graph/topology', { signal: AbortSignal.timeout(10000) });
        const topo = topoRes.ok ? await topoRes.json() as any : null;

        // Fetch graph stats
        const graphRes = await fetch('http://localhost:3005/v1/graph/stats', { signal: AbortSignal.timeout(5000) });
        const graph = graphRes.ok ? await graphRes.json() as any : null;

        spinner.stop('Brain scan complete', 'ok');

        if (options.json) {
            console.log(JSON.stringify({ topology: topo, graph }, null, 2));
            return;
        }

        // ── Topology ─────────────────────────────────────────
        if (topo) {
            printSection('Network Topology (Watts-Strogatz)', '🌐');

            const sigma = topo.sigma || 0;
            const sigmaColor = sigma > 1 ? C.GREEN : sigma > 0.5 ? C.YELLOW : C.RED;
            const sigmaLabel = sigma > 1 ? 'Small-World ✓' : sigma > 0.5 ? 'Evolving' : 'Sparse';

            printTable(
                ['Metric', 'Value', 'Assessment'],
                [
                    ['σ (Small-World Index)', `${sigma.toFixed(3)}`, sigmaLabel],
                    ['Avg Path Length (L)', `${(topo.avgPathLength || 0).toFixed(3)}`, topo.avgPathLength < 4 ? 'Efficient' : 'Growing'],
                    ['Clustering (C)', `${(topo.clusteringCoefficient || 0).toFixed(3)}`, topo.clusteringCoefficient > 0.3 ? 'Strong' : 'Sparse'],
                    ['Nodes', `${topo.nodeCount || '?'}`, '-'],
                    ['Edges', `${topo.edgeCount || '?'}`, '-'],
                    ['Bridges', `${topo.bridges?.length || 0}`, topo.bridges?.length > 0 ? 'Cross-domain connections exist' : 'No bridges yet'],
                ]
            );

            // Visual σ meter
            const sigmaBar = Math.min(Math.round(sigma * 5), 20);
            console.log(`    ${C.BOLD}σ Meter:${C.RESET}  ${sigmaColor}${'█'.repeat(sigmaBar)}${C.GRAY}${'░'.repeat(Math.max(0, 20 - sigmaBar))}${C.RESET}  ${sigmaColor}${sigma.toFixed(2)}${C.RESET}\n`);
        } else {
            printCheck('warn', 'Topology data unavailable', 'Graph may be empty or Neo4j disconnected');
        }

        // ── Graph Stats ──────────────────────────────────────
        if (graph) {
            printSection('Knowledge Inventory', '📚');
            const stats = graph.stats || graph;
            printTable(
                ['Category', 'Count'],
                [
                    ['Total Concepts', String(stats.totalConcepts || stats.total || '?')],
                    ['Working Memory', String(stats.working || '?')],
                    ['Short-Term', String(stats.shortTerm || '?')],
                    ['Long-Term', String(stats.longTerm || '?')],
                    ['Deep Memory', String(stats.deep || '?')],
                    ['Relationships', String(stats.relationships || stats.edges || '?')],
                ]
            );
        }

    } catch (err: any) {
        spinner.stop('Failed to query brain', 'fail');
        printCheck('fail', err.message?.slice(0, 60));
    }
}
