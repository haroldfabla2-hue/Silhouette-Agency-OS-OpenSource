// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — CHAT COMMAND
// Interactive terminal session with the Cognitive Kernel
// ═══════════════════════════════════════════════════════════════

import readline from 'readline';
import { printCompactBanner, C, printCheck } from '../utils/ui';

export async function chatCommand(options: any) {
    printCompactBanner();
    
    const port = process.env.PORT || 3005;
    const url = `http://localhost:${port}/v1/chat/message`;

    // 1. Verify system is running
    try {
        const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) throw new Error();
    } catch {
        printCheck('fail', 'Kernel Offline', 'Cannot connect to Silhouette Backend. Run `silhouette start` first.\n');
        process.exit(1);
    }

    console.log(`    ${C.CYAN}Connected to Silhouette OS (Port ${port})${C.RESET}`);
    console.log(`    ${C.GRAY}Type 'exit' or 'quit' to end the session.${C.RESET}\n`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `  ${C.BOLD}${C.WHITE}You:${C.RESET} `
    });

    const sessionId = options.session || `cli-${Date.now()}`;

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            rl.close();
            return;
        }

        if (!input) {
            rl.prompt();
            return;
        }

        try {
            process.stdout.write(`  ${C.BOLD}${C.CYAN}Silhouette:${C.RESET} `);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: input,
                    sessionId: sessionId,
                    channel: 'cli'
                })
            });

            if (!res.ok) {
                console.log(`${C.RED}[Error: API returned ${res.status}]${C.RESET}`);
            } else {
                const data: any = await res.json();
                // If it's the standard format, response is in data.response
                const text = data.response || data.message || "No response.";
                console.log(`${text}`);
                
                // Print any generated assets if they exist
                if (data.metadata?.assets && data.metadata.assets.length > 0) {
                    console.log(`\n    ${C.YELLOW}📎 Created ${data.metadata.assets.length} asset(s):${C.RESET}`);
                    for (const asset of data.metadata.assets) {
                        console.log(`      - ${asset}`);
                    }
                }
            }
        } catch (error: any) {
            console.log(`${C.RED}[Connection Error: ${error.message}]${C.RESET}`);
        }

        console.log();
        rl.prompt();
    }).on('close', () => {
        console.log(`\n    ${C.GRAY}Session ended.${C.RESET}`);
        process.exit(0);
    });
}
