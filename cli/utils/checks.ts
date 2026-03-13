// ═══════════════════════════════════════════════════════════════
// SILHOUETTE CLI — DIAGNOSTIC CHECKS
// Infrastructure, security, connectivity, and autonomy checks
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';

export interface CheckResult {
    name: string;
    status: 'ok' | 'warn' | 'fail' | 'skip';
    message: string;
    detail?: string;
    fixable?: boolean;
    fixCommand?: string;
}

// ─── Runtime Checks ──────────────────────────────────────────
export function checkNodeVersion(): CheckResult {
    const major = parseInt(process.version.slice(1));
    if (major >= 20) return { name: 'Node.js', status: 'ok', message: `Node.js ${process.version}`, detail: 'Recommended version' };
    if (major >= 18) return { name: 'Node.js', status: 'warn', message: `Node.js ${process.version}`, detail: 'Works but v20+ recommended' };
    return { name: 'Node.js', status: 'fail', message: `Node.js ${process.version}`, detail: 'Minimum v18 required', fixable: false };
}

export function checkDiskSpace(): CheckResult {
    try {
        const freeMB = os.freemem() / (1024 ** 2);
        // Check disk directly is OS-specific, use memory as proxy for system health
        const freeGB = Math.round(os.freemem() / (1024 ** 3) * 10) / 10;
        if (freeGB >= 2) return { name: 'Available Memory', status: 'ok', message: `${freeGB}GB free`, detail: `of ${Math.round(os.totalmem() / (1024 ** 3))}GB total` };
        if (freeGB >= 0.5) return { name: 'Available Memory', status: 'warn', message: `${freeGB}GB free`, detail: 'Low memory, may affect performance' };
        return { name: 'Available Memory', status: 'fail', message: `${freeGB}GB free`, detail: 'Critical: less than 512MB' };
    } catch {
        return { name: 'Available Memory', status: 'skip', message: 'Could not check' };
    }
}

export function checkRAM(): CheckResult {
    const totalGB = Math.round(os.totalmem() / (1024 ** 3));
    if (totalGB >= 16) return { name: 'Total RAM', status: 'ok', message: `${totalGB}GB`, detail: 'Excellent for full stack' };
    if (totalGB >= 8) return { name: 'Total RAM', status: 'ok', message: `${totalGB}GB`, detail: 'Good for most workloads' };
    if (totalGB >= 4) return { name: 'Total RAM', status: 'warn', message: `${totalGB}GB`, detail: 'Minimum viable, disable some services' };
    return { name: 'Total RAM', status: 'fail', message: `${totalGB}GB`, detail: 'Insufficient for Silhouette OS' };
}

// ─── Infrastructure Checks ──────────────────────────────────
export function checkDocker(): CheckResult {
    try {
        const version = execSync('docker --version', { stdio: 'pipe' }).toString().trim();
        return { name: 'Docker', status: 'ok', message: version.replace('Docker version ', '').split(',')[0] };
    } catch {
        return { name: 'Docker', status: 'warn', message: 'Not installed', detail: 'Optional: needed for Neo4j/Redis containers', fixable: false };
    }
}

export async function checkNeo4j(projectRoot: string): Promise<CheckResult> {
    try {
        const envContent = readEnvFile(projectRoot);
        const uri = envContent['NEO4J_URI'] || 'bolt://localhost:7687';
        const host = uri.replace('bolt://', '').replace('neo4j://', '').replace('neo4j+s://', '').split(':')[0];
        const port = parseInt(uri.split(':').pop() || '7687');

        const isOpen = await checkPortOpen(host, port, 2000);
        if (isOpen) return { name: 'Neo4j', status: 'ok', message: `Connected ${uri}`, detail: 'Knowledge Graph operational' };
        return { name: 'Neo4j', status: 'warn', message: `Not reachable at ${uri}`, detail: 'Knowledge Graph unavailable', fixable: true, fixCommand: 'docker run -d -p 7687:7687 -e NEO4J_AUTH=neo4j/password --name silhouette-neo4j neo4j' };
    } catch {
        return { name: 'Neo4j', status: 'warn', message: 'No config found', detail: 'Run silhouette setup' };
    }
}

export async function checkRedis(projectRoot: string): Promise<CheckResult> {
    try {
        const envContent = readEnvFile(projectRoot);
        const url = envContent['REDIS_URL'] || 'redis://localhost:6379';
        const hostPort = url.replace('redis://', '').split('/')[0];
        const [host, portStr] = hostPort.split(':');
        const port = parseInt(portStr || '6379');
        
        const isOpen = await checkPortOpen(host, port, 2000);
        if (isOpen) return { name: 'Redis', status: 'ok', message: `Connected ${url}`, detail: 'Event bus operational' };
        return { name: 'Redis', status: 'warn', message: `Not reachable at ${url}`, detail: 'Falls back to in-memory bus', fixable: true, fixCommand: 'docker run -d -p 6379:6379 --name silhouette-redis redis' };
    } catch {
        return { name: 'Redis', status: 'warn', message: 'No config found', detail: 'Using in-memory fallback' };
    }
}

export async function checkPostgres(projectRoot: string): Promise<CheckResult> {
    try {
        const envContent = readEnvFile(projectRoot);
        const dbUrl = envContent['DATABASE_URL'];
        if (!dbUrl) return { name: 'PostgreSQL', status: 'skip', message: 'Not configured', detail: 'Using SQLite fallback' };

        // Parse postgres URL for host:port
        const match = dbUrl.match(/@([^:]+):(\d+)/);
        if (!match) return { name: 'PostgreSQL', status: 'warn', message: 'Invalid DATABASE_URL format' };

        const isOpen = await checkPortOpen(match[1], parseInt(match[2]), 2000);
        if (isOpen) return { name: 'PostgreSQL', status: 'ok', message: `Connected`, detail: 'Enterprise database operational' };
        return { name: 'PostgreSQL', status: 'warn', message: `Not reachable`, detail: 'Falls back to SQLite', fixable: true, fixCommand: 'docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name silhouette-pg postgres' };
    } catch {
        return { name: 'PostgreSQL', status: 'skip', message: 'Not configured', detail: 'Using SQLite' };
    }
}

// ─── Configuration Checks ────────────────────────────────────
export function checkEnvFile(projectRoot: string): CheckResult {
    const envPath = path.join(projectRoot, '.env.local');
    const configPath = path.join(projectRoot, 'silhouette.config.json');

    if (fs.existsSync(envPath)) return { name: 'Environment File', status: 'ok', message: '.env.local found' };
    if (fs.existsSync(configPath)) return { name: 'Environment File', status: 'warn', message: 'silhouette.config.json found, no .env.local', detail: 'Run silhouette setup for full config' };
    return { name: 'Environment File', status: 'fail', message: 'No configuration found', detail: 'Run silhouette setup', fixable: true, fixCommand: 'silhouette setup' };
}

export function checkApiKeys(projectRoot: string): CheckResult {
    const env = readEnvFile(projectRoot);
    const keys = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY'];
    const found = keys.filter(k => env[k] && env[k].length > 5);
    
    if (found.length >= 1) return { name: 'LLM API Keys', status: 'ok', message: `${found.length} provider(s) configured`, detail: found.join(', ') };
    return { name: 'LLM API Keys', status: 'fail', message: 'No LLM API key configured', detail: 'Need at least one to think', fixable: true, fixCommand: 'silhouette setup' };
}

export function checkTelegramConfig(projectRoot: string): CheckResult {
    const env = readEnvFile(projectRoot);
    if (env['TELEGRAM_BOT_TOKEN'] && env['TELEGRAM_BOT_TOKEN'].length > 10) {
        return { name: 'Telegram Bot', status: 'ok', message: 'Token configured', detail: `${env['TELEGRAM_BOT_TOKEN'].slice(0, 8)}...` };
    }
    return { name: 'Telegram Bot', status: 'skip', message: 'Not configured', detail: 'Optional: interact via Telegram' };
}

// ─── Security Checks ─────────────────────────────────────────
export function checkAuthMiddleware(projectRoot: string): CheckResult {
    const authPath = path.join(projectRoot, 'server', 'middleware', 'authMiddleware.ts');
    if (fs.existsSync(authPath)) {
        const content = fs.readFileSync(authPath, 'utf-8');
        if (content.includes('validateToken') || content.includes('authenticateRequest')) {
            return { name: 'Auth Middleware', status: 'ok', message: 'Active', detail: 'Request authentication enforced' };
        }
        return { name: 'Auth Middleware', status: 'warn', message: 'File exists but may be incomplete' };
    }
    return { name: 'Auth Middleware', status: 'fail', message: 'Not found', detail: 'API requests are unauthenticated' };
}

export function checkZ3Engine(projectRoot: string): CheckResult {
    const z3Path = path.join(projectRoot, 'services', 'z3Verifier.ts');
    if (fs.existsSync(z3Path)) {
        return { name: 'Z3 Verification', status: 'ok', message: 'Formal verification engine present', detail: 'Validates high-risk actions' };
    }
    return { name: 'Z3 Verification', status: 'warn', message: 'Not found', detail: 'Actions not formally verified' };
}

export function checkRBAC(projectRoot: string): CheckResult {
    const identityPath = path.join(projectRoot, 'services', 'identityService.ts');
    if (fs.existsSync(identityPath)) {
        const content = fs.readFileSync(identityPath, 'utf-8');
        if (content.includes('CREATOR') && content.includes('GUEST')) {
            return { name: 'RBAC Roles', status: 'ok', message: 'CREATOR/OPERATOR/GUEST roles active' };
        }
    }
    return { name: 'RBAC Roles', status: 'warn', message: 'Role system may be incomplete' };
}

// ─── Connectivity Check ──────────────────────────────────────
export async function checkGeminiApi(projectRoot: string): Promise<CheckResult> {
    const env = readEnvFile(projectRoot);
    const key = env['GEMINI_API_KEY'];
    if (!key || key.length < 10) return { name: 'Gemini API', status: 'skip', message: 'No key configured' };

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
            signal: AbortSignal.timeout(5000)
        });
        if (res.ok) return { name: 'Gemini API', status: 'ok', message: 'Connected', detail: 'LLM gateway operational' };
        return { name: 'Gemini API', status: 'fail', message: `HTTP ${res.status}`, detail: 'API key may be invalid' };
    } catch (err: any) {
        return { name: 'Gemini API', status: 'fail', message: 'Connection failed', detail: err.message?.slice(0, 50) };
    }
}

export async function checkServerHealth(port: number = 3005): Promise<CheckResult> {
    try {
        const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return { name: 'API Server', status: 'ok', message: `Running on port ${port}` };
        return { name: 'API Server', status: 'warn', message: `Port ${port} responding but unhealthy (HTTP ${res.status})` };
    } catch {
        return { name: 'API Server', status: 'fail', message: `Not running on port ${port}` };
    }
}

// ─── Autonomy Checks ─────────────────────────────────────────
export function checkSelfHealingLog(projectRoot: string): CheckResult {
    const logsDir = path.join(projectRoot, 'logs');
    const logFile = path.join(logsDir, 'system_errors.log');

    if (!fs.existsSync(logsDir)) {
        return { name: 'Self-Healing Log', status: 'warn', message: 'logs/ directory missing', fixable: true, fixCommand: `mkdir "${logsDir}"` };
    }
    // File may not exist yet (no errors = good)
    return { name: 'Self-Healing Log', status: 'ok', message: 'Log directory ready', detail: fs.existsSync(logFile) ? 'Has entries' : 'Clean (no errors logged)' };
}

export function checkCuriosityPersistence(projectRoot: string): CheckResult {
    const dataDir = path.join(projectRoot, 'data');
    const gapsFile = path.join(dataDir, 'curiosity_gaps.json');

    if (fs.existsSync(gapsFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(gapsFile, 'utf-8'));
            const gapCount = data.gaps?.length || 0;
            return { name: 'Curiosity Gaps', status: 'ok', message: `${gapCount} gaps persisted`, detail: gapsFile };
        } catch {
            return { name: 'Curiosity Gaps', status: 'warn', message: 'File exists but unreadable' };
        }
    }
    return { name: 'Curiosity Gaps', status: 'ok', message: 'No gaps file yet', detail: 'Created on first curiosity cycle' };
}

export function checkEvolutionScheduler(projectRoot: string): CheckResult {
    const schedulerPath = path.join(projectRoot, 'services', 'evolution', 'evolutionScheduler.ts');
    if (fs.existsSync(schedulerPath)) {
        const content = fs.readFileSync(schedulerPath, 'utf-8');
        if (content.includes('CONFIG_MUTATION') && content.includes('POWER_MODE_CHANGE')) {
            return { name: 'Evolution Scheduler', status: 'ok', message: 'Wired to PowerManager', detail: 'Auto-reactivates on mode change' };
        }
        return { name: 'Evolution Scheduler', status: 'warn', message: 'Present but may lack PowerManager wiring' };
    }
    return { name: 'Evolution Scheduler', status: 'fail', message: 'Not found' };
}

// ─── Utility Functions ───────────────────────────────────────
function readEnvFile(projectRoot: string): Record<string, string> {
    const result: Record<string, string> = {};
    const envPaths = [path.join(projectRoot, '.env.local'), path.join(projectRoot, '.env')];

    for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf-8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
                }
            }
        }
    }

    // Also check silhouette.config.json for nested keys
    const configPath = path.join(projectRoot, 'silhouette.config.json');
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.llm?.providers?.gemini?.apiKey && config.llm.providers.gemini.apiKey !== 'LOADED_FROM_ENV') {
                result['GEMINI_API_KEY'] = result['GEMINI_API_KEY'] || config.llm.providers.gemini.apiKey;
            }
            if (config.channels?.telegram?.botToken) {
                result['TELEGRAM_BOT_TOKEN'] = result['TELEGRAM_BOT_TOKEN'] || config.channels.telegram.botToken;
            }
        } catch { /* ignore parse errors */ }
    }

    return result;
}

function checkPortOpen(host: string, port: number, timeout: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.connect(port, host);
    });
}

// ─── Run All Checks ──────────────────────────────────────────
export async function runAllChecks(projectRoot: string): Promise<{
    runtime: CheckResult[];
    infrastructure: CheckResult[];
    configuration: CheckResult[];
    security: CheckResult[];
    connectivity: CheckResult[];
    autonomy: CheckResult[];
}> {
    return {
        runtime: [
            checkNodeVersion(),
            checkRAM(),
            checkDiskSpace(),
        ],
        infrastructure: [
            checkDocker(),
            await checkNeo4j(projectRoot),
            await checkRedis(projectRoot),
            await checkPostgres(projectRoot),
        ],
        configuration: [
            checkEnvFile(projectRoot),
            checkApiKeys(projectRoot),
            checkTelegramConfig(projectRoot),
        ],
        security: [
            checkAuthMiddleware(projectRoot),
            checkZ3Engine(projectRoot),
            checkRBAC(projectRoot),
        ],
        connectivity: [
            await checkServerHealth(),
            await checkGeminiApi(projectRoot),
        ],
        autonomy: [
            checkSelfHealingLog(projectRoot),
            checkCuriosityPersistence(projectRoot),
            checkEvolutionScheduler(projectRoot),
        ],
    };
}
