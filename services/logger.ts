/**
 * 🧠 SILHOUETTE STRUCTURED LOGGER
 * ══════════════════════════════════════════════════════════════
 * Zero-dependency structured JSON logger for production observability.
 * Uses `pino` if installed, otherwise falls back to formatted `console.*`.
 * 
 * Usage:
 *   import { logger } from './logger';
 *   logger.info({ service: 'narrator', intent: 'CURIOSITY' }, 'Thought classified');
 *   logger.error({ agentId: 'orch-01', error: err.message }, 'Agent execution failed');
 *   
 *   // Create child logger scoped to a service:
 *   const log = logger.child({ service: 'ThoughtNarrator' });
 *   log.info({ disposition: 'ACT_NOW', score: 0.82 }, 'System 2 evaluation');
 * ══════════════════════════════════════════════════════════════
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogContext {
    [key: string]: any;
}

interface Logger {
    debug(ctx: LogContext, msg: string): void;
    info(ctx: LogContext, msg: string): void;
    warn(ctx: LogContext, msg: string): void;
    error(ctx: LogContext, msg: string): void;
    fatal(ctx: LogContext, msg: string): void;
    child(bindings: LogContext): Logger;
}

// ─── Log level priority ──────────────────────────────────────
const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    fatal: 50
};

const LEVEL_ICONS: Record<LogLevel, string> = {
    debug: '🔍',
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
    fatal: '💀'
};

// ─── Determine minimum log level from environment ────────────
function getMinLevel(): LogLevel {
    const env = typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined;
    if (env && env in LEVEL_PRIORITY) return env as LogLevel;
    const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
    return nodeEnv === 'production' ? 'info' : 'debug';
}

// ─── Fallback: Structured Console Logger ─────────────────────
// Outputs JSON lines in production, pretty-prints in development.
class ConsoleStructuredLogger implements Logger {
    private bindings: LogContext;
    private minLevel: number;
    private isProd: boolean;

    constructor(bindings: LogContext = {}) {
        this.bindings = bindings;
        this.minLevel = LEVEL_PRIORITY[getMinLevel()];
        this.isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    }

    private log(level: LogLevel, ctx: LogContext, msg: string): void {
        if (LEVEL_PRIORITY[level] < this.minLevel) return;

        const entry: Record<string, any> = {
            level,
            time: new Date().toISOString(),
            msg,
            ...this.bindings,
            ...ctx
        };

        if (this.isProd) {
            // Production: JSON lines (machine-parseable for log aggregators)
            const consoleFn = level === 'error' || level === 'fatal' ? console.error
                : level === 'warn' ? console.warn
                    : console.log;
            consoleFn(JSON.stringify(entry));
        } else {
            // Development: Human-readable with icons
            const icon = LEVEL_ICONS[level];
            const service = entry.service ? `[${entry.service}]` : '';
            const contextStr = Object.keys(ctx).length > 0
                ? ` ${JSON.stringify(ctx)}`
                : '';

            const consoleFn = level === 'error' || level === 'fatal' ? console.error
                : level === 'warn' ? console.warn
                    : level === 'debug' ? console.debug
                        : console.log;

            consoleFn(`${icon} ${service} ${msg}${contextStr}`);
        }
    }

    debug(ctx: LogContext, msg: string): void { this.log('debug', ctx, msg); }
    info(ctx: LogContext, msg: string): void { this.log('info', ctx, msg); }
    warn(ctx: LogContext, msg: string): void { this.log('warn', ctx, msg); }
    error(ctx: LogContext, msg: string): void { this.log('error', ctx, msg); }
    fatal(ctx: LogContext, msg: string): void { this.log('fatal', ctx, msg); }

    child(bindings: LogContext): Logger {
        return new ConsoleStructuredLogger({ ...this.bindings, ...bindings });
    }
}

// ─── Factory: Try pino, fall back to Console ─────────────────
function createLogger(): Logger {
    try {
        // Dynamic require to avoid build-time dependency
        const pino = require('pino');
        return pino({
            level: getMinLevel(),
            transport: typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined
        });
    } catch {
        // Pino not installed — use structured console fallback
        return new ConsoleStructuredLogger();
    }
}

// ─── Singleton Export ────────────────────────────────────────
export const logger: Logger = createLogger();

// ─── Pre-built service loggers for key subsystems ────────────
export const narratorLog = logger.child({ service: 'ThoughtNarrator' });
export const daemonLog = logger.child({ service: 'UnifiedDaemon' });
export const orchestratorLog = logger.child({ service: 'Orchestrator' });
export const consciousnessLog = logger.child({ service: 'ConsciousnessEngine' });
export const memoryLog = logger.child({ service: 'ContinuumMemory' });
