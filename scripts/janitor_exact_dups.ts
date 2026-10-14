/**
 * Exact-duplicate sweep runner (roadmap: doctor duplicate groups).
 *
 * Default is a DRY RUN: prints the plan, touches nothing, writes no ledger.
 *   npx tsx scripts/janitor_exact_dups.ts            # dry-run, read-only
 *   npx tsx scripts/janitor_exact_dups.ts --apply    # marks + ledger + verify
 *
 * Eternal-memory safe: --apply never deletes; duplicates gain SUPERSEDED /
 * SUPERSEDED_BY:<canonicalId> tags (reversible via janitor unsupersede()).
 * Deterministic and LLM-free — no provider calls, zero cost.
 */
import 'dotenv/config';
import { lancedbService } from '../services/lancedbService';
import { RevisionLedger, defaultLedgerPath } from '../services/janitor/revisionLedger';
import { planExactDuplicateSupersede, runExactDuplicateSweep } from '../services/janitor/exactDuplicateSweep';

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const nodes = await lancedbService.getAllNodes();
    const groups = planExactDuplicateSupersede(nodes);
    const byId = new Map(nodes.map(n => [n.id, n]));

    console.log(`Universe: ${nodes.length} persistent nodes; ${groups.length} exact-duplicate group(s).`);
    for (const g of groups) {
        const canonical = byId.get(g.canonicalId);
        const preview = (canonical?.content || '').slice(0, 80).replace(/\s+/g, ' ');
        console.log(`- canonical ${g.canonicalId}  supersedes [${g.supersedeIds.join(', ')}]`);
        console.log(`  "${preview}${(canonical?.content || '').length > 80 ? '…' : ''}"`);
    }

    if (!apply) {
        console.log('DRY RUN — nothing written. Re-run with --apply to mark superseded copies.');
        return;
    }

    const report = await runExactDuplicateSweep({
        getAllNodes: () => lancedbService.getAllNodes(),
        upsertNode: async (n) => { await lancedbService.store(n); },
        ledger: new RevisionLedger(defaultLedgerPath()),
        now: () => Date.now(),
    }, false);

    // Independent verification: re-read the store and re-plan.
    const after = planExactDuplicateSupersede(await lancedbService.getAllNodes());
    console.log(`APPLIED: ${report.supersededIds.length} node(s) marked SUPERSEDED across ${report.groups} group(s).`);
    console.log(`Post-sweep audit: ${after.length} exact-duplicate group(s) remain.`);
    if (after.length > 0) {
        console.error('VERIFICATION FAILED: duplicate groups remain after apply.');
        process.exit(1);
    }
}

main().catch((e) => { console.error('Sweep failed:', e); process.exit(1); });
