// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — BRAIN COMMAND
// Knowledge Graph stats: σ index, concepts, bridges, topology
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printCheck, printTable, isServerRunning, Spinner } from '../utils/ui';

interface BrainOptions {
    json?: boolean;
    remote?: boolean;
}

export async function brainCommand(options: BrainOptions) {
    printCompactBanner();

    // ── Remote mode: query the external silhouette-brain 4-Tier memory service ──
    if (options.remote) {
        await remoteBrainCommand(options);
        return;
    }

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

// ═══════════════════════════════════════════════════════════════
// REMOTE BRAIN — external silhouette-brain 4-Tier memory service
// ═══════════════════════════════════════════════════════════════
async function remoteBrainCommand(options: BrainOptions) {
    printSection('Silhouette Brain — External 4-Tier Memory', '🧠');

    const { brainClient } = await import('../../services/brain');

    if (!brainClient.isEnabled()) {
        printCheck('warn', 'Brain integration disabled');
        console.log(`    ${C.GRAY}Enable it by setting ${C.WHITE}BRAIN_API_URL${C.GRAY} (e.g. http://localhost:9876)${C.RESET}\n`);
        return;
    }

    const spinner = new Spinner(`Connecting to ${brainClient.getBaseUrl()}...`);
    spinner.start();

    try {
        const status = await brainClient.getStatus();
        spinner.stop('Brain probe complete', status ? 'ok' : 'fail');

        if (options.json) {
            console.log(JSON.stringify({ baseUrl: brainClient.getBaseUrl(), status }, null, 2));
            return;
        }

        if (!status) {
            printCheck('fail', `Brain unreachable at ${brainClient.getBaseUrl()}`);
            console.log(`    ${C.GRAY}Is the silhouette-brain service running? (docker compose up brain)${C.RESET}\n`);
            return;
        }

        const f = status.features || {};
        printTable(
            ['Capability', 'Status'],
            [
                ['Service', status.status === 'ok' ? 'ONLINE ✓' : String(status.status)],
                ['Version', String(status.version || '?')],
                ['Embeddings', f.embeddings ? 'YES' : 'no'],
                ['Reasoning Engine', f.reasoning ? 'YES' : 'no'],
                ['Context Assembler', f.context_assembler ? 'YES' : 'no'],
                ['Neo4j (Deep)', f.neo4j ? 'YES' : 'no'],
                ['4-Tier Memory', f['4_tier'] ? 'YES' : 'no'],
            ]
        );
    } catch (err: any) {
        spinner.stop('Failed to query remote brain', 'fail');
        printCheck('fail', err.message?.slice(0, 60));
    }
}
