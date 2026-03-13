// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — EVOLVE COMMAND
// Trigger manual evolution cycle for agents
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printCheck, isServerRunning, Spinner } from '../utils/ui';

interface EvolveOptions {
    all?: boolean;
    dryRun?: boolean;
}

export async function evolveCommand(agentId: string | undefined, options: EvolveOptions) {
    printCompactBanner();
    printSection('Agent Evolution', '🧬');

    if (!await isServerRunning()) {
        printCheck('fail', 'Server is not running');
        console.log(`    ${C.GRAY}Start with: ${C.WHITE}silhouette start${C.RESET}\n`);
        process.exit(1);
    }

    if (options.all) {
        const spinner = new Spinner('Fetching agents...');
        spinner.start();

        try {
            const res = await fetch('http://localhost:3005/v1/orchestrator/agents', { signal: AbortSignal.timeout(5000) });
            const data = await res.json() as any;
            const agents = Array.isArray(data) ? data : data?.agents || [];
            spinner.stop(`Found ${agents.length} agents`, 'ok');

            for (const agent of agents) {
                await evolveAgent(agent.id, agent.name, options.dryRun);
            }
        } catch (err: any) {
            spinner.stop('Failed to fetch agents', 'fail');
        }
    } else if (agentId) {
        await evolveAgent(agentId, agentId, options.dryRun);
    } else {
        console.log(`    ${C.YELLOW}Usage:${C.RESET}`);
        console.log(`    ${C.WHITE}silhouette evolve <agentId>${C.RESET}     Evolve specific agent`);
        console.log(`    ${C.WHITE}silhouette evolve --all${C.RESET}         Evolve all agents\n`);
    }
}

async function evolveAgent(id: string, name: string, dryRun?: boolean) {
    if (dryRun) {
        printCheck('ok', `[DRY RUN] Would evolve: ${name} (${id})`);
        return;
    }

    try {
        const res = await fetch(`http://localhost:3005/v1/orchestrator/evolve/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000)
        });
        const result = await res.json() as any;

        if (result.success) {
            printCheck('ok', `${name}: ${result.previousScore || '?'} → ${result.newScore || '?'}`, 'Evolved');
        } else {
            printCheck('warn', `${name}: Already optimized or no evolution needed`);
        }
    } catch (err: any) {
        printCheck('fail', `${name}: Evolution failed`, err.message?.slice(0, 40));
    }
}
