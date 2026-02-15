// =============================================================================
// ENHANCED SCHEDULER SERVICE
// Extends the existing SchedulerService with cron expression parsing,
// webhook callbacks, and integration with SystemBus for event-driven triggers.
// =============================================================================

import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// ─── Cron Expression Parser ──────────────────────────────────────────────────

/**
 * A lightweight cron expression evaluator.
 * Supports: second minute hour dayOfMonth month dayOfWeek
 * (6-field cron or 5-field standard)
 */
export function matchesCron(cronExpr: string, date: Date = new Date()): boolean {
    const parts = cronExpr.trim().split(/\s+/);

    // Support 5-field (standard) or 6-field (with seconds)
    let second = '*', minute: string, hour: string, dayOfMonth: string, month: string, dayOfWeek: string;

    if (parts.length === 6) {
        [second, minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    } else if (parts.length === 5) {
        [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    } else {
        return false;
    }

    return (
        matchField(second, date.getSeconds(), 0, 59) &&
        matchField(minute!, date.getMinutes(), 0, 59) &&
        matchField(hour!, date.getHours(), 0, 23) &&
        matchField(dayOfMonth!, date.getDate(), 1, 31) &&
        matchField(month!, date.getMonth() + 1, 1, 12) &&
        matchField(dayOfWeek!, date.getDay(), 0, 6)
    );
}

function matchField(expr: string, value: number, min: number, max: number): boolean {
    if (expr === '*') return true;

    // Handle step values: */5
    if (expr.startsWith('*/')) {
        const step = parseInt(expr.slice(2), 10);
        return value % step === 0;
    }

    // Handle ranges: 1-5
    if (expr.includes('-')) {
        const [start, end] = expr.split('-').map(Number);
        return value >= start && value <= end;
    }

    // Handle lists: 1,3,5
    if (expr.includes(',')) {
        return expr.split(',').map(Number).includes(value);
    }

    // Exact match
    return parseInt(expr, 10) === value;
}

// ─── Webhook Job Type ────────────────────────────────────────────────────────

export interface WebhookJob {
    id: string;
    name: string;
    /** Cron expression for scheduling */
    cronExpression: string;
    /** URL to call when the job fires */
    webhookUrl: string;
    /** HTTP method */
    method: 'GET' | 'POST' | 'PUT';
    /** Request headers */
    headers?: Record<string, string>;
    /** Request body */
    body?: unknown;
    /** Whether this job is enabled */
    enabled: boolean;
    /** When this job last fired */
    lastFireAt?: number;
    /** Next calculated fire time */
    nextFireAt?: number;
    /** Number of times fired */
    fireCount: number;
    /** Last result */
    lastResult?: {
        status: number;
        success: boolean;
        responseTime: number;
    };
}

// ─── Enhanced Scheduler ──────────────────────────────────────────────────────

class CronScheduler {
    private webhookJobs: Map<string, WebhookJob> = new Map();
    private interval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL_MS = 60_000; // Check every minute

    initialize(): void {
        this.interval = setInterval(() => this.tick(), this.CHECK_INTERVAL_MS);
        console.log('[CronScheduler] ⏰ Started');
    }

    /**
     * Register a new webhook job.
     */
    addWebhookJob(job: Omit<WebhookJob, 'id' | 'fireCount' | 'nextFireAt'>): string {
        const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newJob: WebhookJob = {
            ...job,
            id,
            fireCount: 0,
        };
        this.webhookJobs.set(id, newJob);

        systemBus.emit(SystemProtocol.DIAGNOSTICS_DATA, {
            type: 'cron_job_added',
            jobId: id,
            name: job.name,
        }, 'CronScheduler');

        return id;
    }

    /**
     * Remove a webhook job.
     */
    removeWebhookJob(id: string): boolean {
        return this.webhookJobs.delete(id);
    }

    /**
     * List all webhook jobs.
     */
    listWebhookJobs(): WebhookJob[] {
        return Array.from(this.webhookJobs.values());
    }

    /**
     * Tick: check all cron jobs and execute those that match.
     */
    private async tick(): Promise<void> {
        const now = new Date();

        for (const job of this.webhookJobs.values()) {
            if (!job.enabled) continue;
            if (!matchesCron(job.cronExpression, now)) continue;

            // Fire the webhook
            this.fireWebhook(job).catch(err => {
                console.error(`[CronScheduler] Webhook ${job.name} failed:`, err.message);
            });
        }
    }

    /**
     * Fire a webhook job.
     */
    private async fireWebhook(job: WebhookJob): Promise<void> {
        const start = Date.now();

        try {
            const options: RequestInit = {
                method: job.method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Silhouette-Cron-Job': job.id,
                    ...job.headers,
                },
            };

            if (job.body && job.method !== 'GET') {
                options.body = JSON.stringify(job.body);
            }

            const response = await fetch(job.webhookUrl, options);
            const responseTime = Date.now() - start;

            job.lastFireAt = Date.now();
            job.fireCount++;
            job.lastResult = {
                status: response.status,
                success: response.ok,
                responseTime,
            };

            console.log(`[CronScheduler] ✅ ${job.name} → ${response.status} (${responseTime}ms)`);

            systemBus.emit(SystemProtocol.DIAGNOSTICS_DATA, {
                type: 'cron_job_fired',
                jobId: job.id,
                name: job.name,
                status: response.status,
                responseTime,
            }, 'CronScheduler');

        } catch (err: any) {
            job.lastFireAt = Date.now();
            job.fireCount++;
            job.lastResult = {
                status: 0,
                success: false,
                responseTime: Date.now() - start,
            };

            console.error(`[CronScheduler] ❌ ${job.name}: ${err.message}`);
        }
    }

    /**
     * Shutdown the scheduler.
     */
    shutdown(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    /**
     * Stats.
     */
    getStats() {
        const jobs = Array.from(this.webhookJobs.values());
        return {
            totalJobs: jobs.length,
            enabledJobs: jobs.filter(j => j.enabled).length,
            totalFires: jobs.reduce((sum, j) => sum + j.fireCount, 0),
        };
    }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const cronScheduler = new CronScheduler();
