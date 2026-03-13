// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — STATUS COMMAND
// Live service dashboard + agent overview
// ═══════════════════════════════════════════════════════════════

import { C, printCompactBanner, printSection, printTable, printCheck, isServerRunning, getProjectRoot } from '../utils/ui';

interface StatusOptions {
    json?: boolean;
    watch?: boolean;
}

export async function statusCommand(options: StatusOptions) {
    if (options.watch) {
        // Clear and re-render every 5 seconds
        const run = async () => {
            console.clear();
            await renderStatus(options.json);
            console.log(`    ${C.GRAY}Refreshing every 5s... Press Ctrl+C to stop${C.RESET}\n`);
        };
        await run();
        setInterval(run, 5000);
    } else {
        await renderStatus(options.json);
    }
}

async function renderStatus(json?: boolean) {
    const port = 3005;
    const running = await isServerRunning(port);

    if (json) {
        const data = running ? await fetchStatusData(port) : { status: 'offline' };
        console.log(JSON.stringify(data, null, 2));
        return;
    }

    printCompactBanner();
    printSection('System Status', '📡');

    if (!running) {
        printCheck('fail', 'Silhouette OS is not running');
        console.log(`    ${C.GRAY}Start with: ${C.WHITE}silhouette start${C.RESET}\n`);
        return;
    }

    printCheck('ok', `API Server online at port ${port}`);

    // ── Fetch live data ──────────────────────────────────────
    try {
        const data = await fetchStatusData(port);

        // Service Table
        if (data.services) {
            printSection('Services', '⚙️');
            const rows = Object.entries(data.services).map(([name, status]: [string, any]) => [
                name,
                typeof status === 'string' ? status : (status?.status || 'UNKNOWN'),
                typeof status === 'object' && status?.uptime ? formatUptime(status.uptime) : '-'
            ]);
            printTable(['Service', 'Status', 'Uptime'], rows);
        }

        // Agent Summary
        if (data.agents) {
            printSection('Agents', '🤖');
            const agentList = Array.isArray(data.agents) ? data.agents : [];
            const byStatus: Record<string, number> = {};
            for (const a of agentList) {
                const s = a.status || 'UNKNOWN';
                byStatus[s] = (byStatus[s] || 0) + 1;
            }
            const rows = Object.entries(byStatus).map(([status, count]) => [status, String(count)]);
            printTable(['Status', 'Count'], rows);
        }

        // Consciousness Metrics
        if (data.consciousness) {
            printSection('Consciousness', '🧠');
            printCheck('ok', `Level: ${data.consciousness.level || 'UNKNOWN'}`);
            printCheck('ok', `Phi: ${(data.consciousness.phiScore || 0).toFixed(3)}`);
            if (data.consciousness.emergenceIndex !== undefined) {
                printCheck('ok', `Emergence: ${data.consciousness.emergenceIndex.toFixed(3)}`);
            }
        }

    } catch (err: any) {
        printCheck('warn', 'Could not fetch detailed status', err.message?.slice(0, 50));
    }
}

async function fetchStatusData(port: number): Promise<any> {
    const result: any = { status: 'online' };

    try {
        const stateRes = await fetch(`http://localhost:${port}/v1/orchestrator/state`, { signal: AbortSignal.timeout(3000) });
        if (stateRes.ok) {
            const state = await stateRes.json() as any;
            result.agents = state.agents || [];
            result.services = state.services || {};
        }
    } catch { /* endpoint may not exist */ }

    try {
        const consRes = await fetch(`http://localhost:${port}/v1/consciousness`, { signal: AbortSignal.timeout(3000) });
        if (consRes.ok) result.consciousness = await consRes.json();
    } catch { /* endpoint may not exist */ }

    return result;
}

function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m ${s % 60}s`;
}
