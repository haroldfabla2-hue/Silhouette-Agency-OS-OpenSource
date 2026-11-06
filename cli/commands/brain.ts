// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — BRAIN COMMAND
// Knowledge Graph stats: σ index, concepts, bridges, topology
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printCheck, printTable, isServerRunning, Spinner, getApiBaseUrl } from '../utils/ui';

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
    const apiBaseUrl = getApiBaseUrl();

    try {
        // Fetch topology report
        const topoRes = await fetch(`${apiBaseUrl}/v1/graph/topology`, { signal: AbortSignal.timeout(10000) });
        const topo = topoRes.ok ? await topoRes.json() as any : null;

        // Fetch graph stats
        const graphRes = await fetch(`${apiBaseUrl}/v1/graph/stats`, { signal: AbortSignal.timeout(5000) });
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
            const totalNodes = topo.totalNodes ?? topo.nodeCount ?? 0;
            const totalEdges = topo.totalEdges ?? topo.edgeCount ?? 0;
            const clustering = topo.avgClustering ?? topo.clusteringCoefficient ?? 0;
            const avgPathLength = topo.avgPathLength ?? topo.pathLength ?? 0;

            printTable(
                ['Metric', 'Value', 'Assessment'],
                [
                    ['σ (Small-World Index)', `${sigma.toFixed(3)}`, sigmaLabel],
                    ['Avg Path Length (L)', `${Number.isFinite(avgPathLength) ? avgPathLength.toFixed(3) : '∞'}`, avgPathLength && avgPathLength < 4 ? 'Efficient' : 'Growing'],
                    ['Clustering (C)', `${clustering.toFixed(3)}`, clustering > 0.3 ? 'Strong' : 'Sparse'],
                    ['Nodes', `${totalNodes || '?'}`, '-'],
                    ['Edges', `${totalEdges || '?'}`, totalEdges > 0 ? 'Connected' : 'No links yet'],
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
                    ['Total Concepts', String(normalizeCount(stats.totalConcepts || stats.total || stats.nodeCount || 0))],
                    ['Working Memory', String(stats.working || '?')],
                    ['Short-Term', String(stats.shortTerm || '?')],
                    ['Long-Term', String(stats.longTerm || '?')],
                    ['Deep Memory', String(stats.deep || '?')],
                    ['Relationships', String(normalizeCount(stats.relationships || stats.edges || stats.relationshipCount || 0))],
                ]
            );
        }

    } catch (err: any) {
        spinner.stop('Failed to query brain', 'fail');
        printCheck('fail', err.message?.slice(0, 60));
    }
}

function normalizeCount(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value?.toNumber === 'function') return value.toNumber();
    if (typeof value?.low === 'number') return value.low;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
