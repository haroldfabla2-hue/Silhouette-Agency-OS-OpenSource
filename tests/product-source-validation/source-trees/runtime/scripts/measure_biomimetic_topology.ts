/** Explicit offline input only. Never imports application boot or provider clients. */
import { readFileSync } from 'node:fs';
import { measureLinkBaselines, type GraphEdge } from '../services/analysis/linkPredictionBaseline';

async function main() {
    const [mode, path, seed = 'silhouette-topology-v1'] = process.argv.slice(2);
    if (!path || !['--json', '--sqlite'].includes(mode)) {
        throw new Error('Usage: npx tsx scripts/measure_biomimetic_topology.ts (--json edges.json | --sqlite local-copy.sqlite) [seed]');
    }
    let edges: GraphEdge[];
    let journal: { decision: string; count: number }[] | null = null;
    if (mode === '--json') {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (!Array.isArray(parsed) || parsed.length > 100_000) throw new Error('Input must be an edge array with at most 100000 rows');
        edges = parsed as GraphEdge[];
    } else {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(path, { readonly: true, fileMustExist: true });
        try {
            db.pragma('query_only = ON');
            const count = db.prepare('SELECT count(*) AS n FROM graph_edges').get() as { n: number };
            if (count.n > 100_000) throw new Error('Edge row budget exceeded: 100000');
            edges = db.prepare('SELECT source, target FROM graph_edges ORDER BY source, target, type').all() as GraphEdge[];
            const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_journal'").get();
            if (exists) journal = db.prepare('SELECT decision, count(*) AS count FROM discovery_journal GROUP BY decision ORDER BY decision').all() as { decision: string; count: number }[];
        } finally { db.close(); }
    }
    console.log(JSON.stringify({
        ...measureLinkBaselines(edges, { seed }),
        discoveryJournalDecisionCounts: journal,
        journalCaveat: 'Decision counts are not accuracy, causal impact, or independent truth. null means not supplied/missing; [] means supplied and empty.',
    }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
