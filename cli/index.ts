#!/usr/bin/env node
// =============================================================================
// SILHOUETTE CLI
// Command-line interface for Silhouette Agency OS.
// Provides doctor diagnostics, status checks, and configuration management.
// =============================================================================

import { loadConfig, validateConfig, saveConfig, SilhouetteConfig } from '../server/config/configSchema';

const BANNER = `
╔═══════════════════════════════════════════════════╗
║          🌑 SILHOUETTE AGENCY OS CLI              ║
║               v2.2.0                              ║
╚═══════════════════════════════════════════════════╝
`;

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdDoctor(): Promise<void> {
    console.log(BANNER);
    console.log('🩺 Running system diagnostics...\n');

    const config = loadConfig();
    const issues = validateConfig(config);

    const checks: { name: string; status: '✅' | '⚠️' | '❌'; message: string }[] = [];

    // 1. Configuration
    checks.push({
        name: 'Configuration',
        status: issues.length === 0 ? '✅' : '⚠️',
        message: issues.length === 0
            ? 'Configuration is valid'
            : `${issues.length} issue(s): ${issues.join('; ')}`,
    });

    // 2. LLM Providers
    const providers = Object.entries(config.llm.providers)
        .filter(([, v]) => v && ((v as any).apiKey || (v as any).baseUrl))
        .map(([k]) => k);
    checks.push({
        name: 'LLM Providers',
        status: providers.length > 0 ? '✅' : '❌',
        message: providers.length > 0
            ? `Configured: ${providers.join(', ')}`
            : 'No providers configured! Set GEMINI_API_KEY or OLLAMA_BASE_URL',
    });

    // 3. Neo4j
    checks.push({
        name: 'Neo4j',
        status: config.memory.neo4j.uri ? '✅' : '⚠️',
        message: `URI: ${config.memory.neo4j.uri || 'not set'}`,
    });

    // 4. Redis
    checks.push({
        name: 'Redis',
        status: config.memory.redis.host ? '✅' : '⚠️',
        message: `${config.memory.redis.host}:${config.memory.redis.port}`,
    });

    // 5. Channels
    const channels = Object.entries(config.channels)
        .filter(([, v]) => v && (v as any).enabled)
        .map(([k]) => k);
    checks.push({
        name: 'Channels',
        status: channels.length > 0 ? '✅' : '⚠️',
        message: channels.length > 0
            ? `Enabled: ${channels.join(', ')}`
            : 'No messaging channels configured',
    });

    // 6. Memory System
    checks.push({
        name: 'Memory (SQLite)',
        status: '✅',
        message: `Path: ${config.memory.sqlitePath}`,
    });

    checks.push({
        name: 'Memory (LanceDB)',
        status: '✅',
        message: `Path: ${config.memory.lanceDbPath}`,
    });

    // 7. Media
    checks.push({
        name: 'TTS (ElevenLabs)',
        status: config.media.elevenlabs?.apiKey ? '✅' : '⚠️',
        message: config.media.elevenlabs?.apiKey ? 'API key configured' : 'Not configured',
    });

    // 8. Tool Security
    checks.push({
        name: 'Tool Security',
        status: config.tools.requireApproval ? '✅' : '⚠️',
        message: config.tools.requireApproval
            ? 'Approval required for dangerous tools'
            : 'WARNING: Tools run without approval',
    });

    // Print results
    console.log('─'.repeat(55));
    for (const check of checks) {
        console.log(`  ${check.status}  ${check.name.padEnd(20)} ${check.message}`);
    }
    console.log('─'.repeat(55));

    const hasErrors = checks.some(c => c.status === '❌');
    const hasWarnings = checks.some(c => c.status === '⚠️');

    if (hasErrors) {
        console.log('\n❌ System has critical issues that must be resolved.');
    } else if (hasWarnings) {
        console.log('\n⚠️  System is functional but has warnings.');
    } else {
        console.log('\n✅ All checks passed!');
    }
}

async function cmdStatus(): Promise<void> {
    console.log(BANNER);
    console.log('📊 System status:\n');

    try {
        // Try to connect to the running server
        const port = process.env.PORT || 3005;
        const res = await fetch(`http://localhost:${port}/v1/system/health`);
        if (res.ok) {
            const data = await res.json();
            console.log(`  Server:     🟢 Online (port ${port})`);
            console.log(`  Uptime:     ${data.uptime ?? 'unknown'}`);
        } else {
            console.log(`  Server:     🔴 Error (HTTP ${res.status})`);
        }
    } catch {
        console.log('  Server:     🔴 Offline');
    }

    // Check WS Gateway
    try {
        const port = process.env.PORT || 3005;
        const ws = await import('ws');
        const socket = new ws.default(`ws://localhost:${port}/ws`);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                socket.close();
                reject(new Error('timeout'));
            }, 2000);
            socket.on('error', () => {
                clearTimeout(timer);
                reject(new Error('connection failed'));
            });
            socket.on('open', () => {
                clearTimeout(timer);
                console.log('  WS Gateway: 🟢 Online');
                socket.close();
                resolve();
            });
        });
    } catch {
        console.log('  WS Gateway: 🔴 Offline');
    }
}

async function cmdConfigShow(): Promise<void> {
    console.log(BANNER);
    const config = loadConfig();

    // Redact secrets for display
    const display = JSON.parse(JSON.stringify(config));
    if (display.llm?.providers) {
        for (const p of Object.values(display.llm.providers) as any[]) {
            if (p?.apiKey) p.apiKey = p.apiKey.slice(0, 8) + '...';
        }
    }

    console.log(JSON.stringify(display, null, 2));
}

async function cmdConfigInit(): Promise<void> {
    console.log(BANNER);
    console.log('📝 Creating silhouette.config.json with defaults...\n');
    const config = loadConfig();
    saveConfig(config);
    console.log('✅ Configuration file created. Edit it to customize your setup.');
    console.log('   Secrets should be set via environment variables (.env.local).');
}

async function cmdConfigMode(): Promise<void> {
    const mode = args[1]; // 'lite' or 'full'
    if (!mode || (mode !== 'lite' && mode !== 'full')) {
        console.log(BANNER);
        console.error('❌ Usage: silhouette config:mode <lite|full>\n');
        console.log('  lite  : Optimized for <8GB RAM (No Neo4j, No Qdrant, No Browser)');
        console.log('  full  : Standard Mode (All systems go)');
        return;
    }

    console.log(BANNER);
    console.log(`🔄 Switching to ${mode.toUpperCase()} mode...`);

    const config = loadConfig();

    if (mode === 'lite') {
        // [PA-058] Lite Mode
        config.modules = {
            graph: false,
            vectorDB: false,
            redis: false,
            browser: false
        };
        // Also set Autonomy defaults for low power
        config.autonomy.maxConcurrentAgents = 3;
        config.autonomy.enableNarrative = false;
        config.autonomy.enableIntrospection = false;

        console.log('  - Disabled: Graph, VectorDB, Redis, Browser');
        console.log('  - Reduced: Max Agents (3)');
    } else {
        // Full Mode
        config.modules = {
            graph: true,
            vectorDB: true,
            redis: true,
            browser: true
        };
        config.autonomy.maxConcurrentAgents = 10;
        config.autonomy.enableNarrative = true;
        config.autonomy.enableIntrospection = true;

        console.log('  - Enabled: Graph, VectorDB, Redis, Browser');
        console.log('  - Restored: Max Agents (10), Narrative, Introspection');
    }

    saveConfig(config);
    console.log('\n✅ Configuration updated. Restart the server to apply changes.');
}

async function cmdOptimizer(): Promise<void> {
    const force = args.includes('--force') || args.includes('-f');
    console.log(BANNER);
    console.log(`🧹 Running resource optimizer${force ? ' (FORCE MODE)' : ''}...\n`);

    try {
        const port = process.env.PORT || 3005;
        const res = await fetch(`http://localhost:${port}/v1/system/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force })
        });

        if (res.ok) {
            const data = await res.json();
            console.log(`✅ Success: ${data.message}`);
        } else {
            console.log(`❌ Error: Server returned ${res.status}`);
            const text = await res.text();
            console.log(text);
        }
    } catch (e: any) {
        console.log(`❌ Failed to connect to server: ${e.message}`);
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

const COMMANDS: Record<string, () => Promise<void>> = {
    'doctor': cmdDoctor,
    'status': cmdStatus,
    'config': cmdConfigShow,
    'config:init': cmdConfigInit,
    'config:mode': cmdConfigMode,
    'optimizer': cmdOptimizer,
    'squad': cmdSquad,
};

if (!command || command === 'help' || command === '--help') {
    console.log(BANNER);
    console.log('Usage: silhouette <command>\n');
    console.log('Commands:');
    console.log('  doctor       Run system diagnostics');
    console.log('  status       Check if services are running');
    console.log('  config       Show current configuration');
    console.log('  config:init  Create silhouette.config.json');
    console.log('  config:mode  Switch hardware mode <lite|full>');
    console.log('  optimizer    Prune idle resources (use --force to prune all)');
    console.log('  squad        Manage squads (list | wake <id>)');
    console.log('  help         Show this help message');
    process.exit(0);
}

// ... existing code ...

async function cmdSquad() {
    const subCommand = args[1];
    const targetId = args[2];

    if (!subCommand || subCommand === 'list') {
        // List Squads
        try {
            const res = await fetch('http://localhost:3005/v1/squads');
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const data: any = await res.json();

            if (data.success) {
                console.log('\n🛡️  ACTIVE SQUADS\n');
                console.table(data.squads.map((s: any) => ({
                    ID: s.id,
                    Name: s.name,
                    Status: s.status,
                    Members: s.memberCount,
                    Leader: s.leaderId
                })));
            } else {
                console.error('❌ Error:', data.error);
            }
        } catch (e: any) {
            console.error(`❌ Failed to fetch squads: ${e.message}`);
        }
    } else if (subCommand === 'wake') {
        // Wake Squad
        if (!targetId) {
            console.error('❌ Error: Missing squad ID. Usage: silhouette squad wake <id>');
            return;
        }
        try {
            const res = await fetch(`http://localhost:3005/v1/squads/${targetId}/wake`, { method: 'POST' });
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const data: any = await res.json();

            if (data.success) {
                console.log(`✅ ${data.message}`);
            } else {
                console.error('❌ Error:', data.error);
            }
        } catch (e: any) {
            console.error(`❌ Failed to wake squad: ${e.message}`);
        }
    } else {
        console.error(`Unknown subcommand: ${subCommand}`);
        console.log('Usage: silhouette squad list');
        console.log('       silhouette squad wake <id>');
    }
}

const handler = COMMANDS[command];
if (!handler) {
    console.error(`Unknown command: ${command}\nRun 'silhouette help' for available commands.`);
    process.exit(1);
}

handler().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
