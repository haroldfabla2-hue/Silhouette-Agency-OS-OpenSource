import { ResourceScope } from '../server/runtime/resourceScope';
/**
 * SCHEDULER SERVICE
 * 
 * Autonomous task scheduling for Silhouette Agency OS.
 * Enables:
 * - Scheduled tasks (cron-like)
 * - Delayed execution
 * - Recurring tasks
 * 
 * Persists to SQLite for survival across restarts.
 */

import { SystemProtocol } from '../types';
import { systemBus } from './systemBus';
import { configLoader } from '../server/config/configLoader';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ScheduledTask {
    id: string;
    name: string;
    description: string;
    cronExpression?: string;        // e.g., "0 9 * * *" (9 AM daily)
    executeAt?: number;             // Unix timestamp for one-time execution
    recurrence?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    action: {
        type: 'PLAN_EXECUTION' | 'GOAL_CHECK' | 'CUSTOM';
        payload: any;
    };
    enabled: boolean;
    lastRun?: number;
    nextRun?: number;
    createdBy: 'USER' | 'SYSTEM' | 'DERIVED';
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export class SchedulerService {
    private tasks: Map<string, ScheduledTask> = new Map();
    private checkInterval: NodeJS.Timeout | null = null;
    private initialCheck: NodeJS.Timeout | null = null;
    private readonly operations = new ResourceScope('autonomous-scheduler');
    private storageTask?: Promise<void>;
    private get storageReady(): Promise<void> { return this.initialize(); }
    public initialize(): Promise<void> {
        if (!this.storageTask) this.storageTask = this.operations.run('scheduler-storage-recovery', () => this.loadTasksFromStorage());
        return this.storageTask;
    }
    public getLifecycleDiagnostics() { return this.operations.getDiagnostics(); }
    public getLifecycleFailures() { return this.operations.getFailures(); }
    public shutdown() { this.stop(); return this.operations.close(); }
    private checking = false;
    private readonly CHECK_INTERVAL_MS = 60000; // Check every minute

    constructor() {}

    /**
     * Start the scheduler daemon
     */
    public start(): boolean {
        this.operations.assertAccepting();
        if (!this.executionAllowed()) { this.stop(); return false; }
        if (this.checkInterval) return true;

        console.log('[SCHEDULER] ⏰ Autonomous Scheduler Started');

        this.checkInterval = setInterval(() => {
            void this.operations.run('scheduler-tick', () => this.checkAndExecuteDueTasks()).catch(() => undefined);
        }, this.CHECK_INTERVAL_MS);

        // Initial check on startup
        this.initialCheck = setTimeout(() => {
            this.initialCheck = null;
            void this.operations.run('scheduler-initial-check', () => this.checkAndExecuteDueTasks()).catch(() => undefined);
        }, 5000);
        const interval = this.checkInterval;
        const initial = this.initialCheck;
        this.operations.own({ name: 'scheduler-cadence', stopIntake: () => { clearInterval(interval); if (initial) clearTimeout(initial); }, close: () => { clearInterval(interval); if (initial) clearTimeout(initial); } });
        return true;
    }

    /**
     * Stop the scheduler
     */
    public stop(): void {
        if (this.initialCheck) {
            clearTimeout(this.initialCheck);
            this.initialCheck = null;
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('[SCHEDULER] ⏸️ Scheduler Stopped');
        }
    }

    /**
     * Schedule a new task
     */
    public scheduleTask(task: Omit<ScheduledTask, 'id' | 'nextRun'>): string {
        this.operations.assertWorkAccepted();
        const id = crypto.randomUUID();
        const nextRun = this.calculateNextRun(task);

        const fullTask: ScheduledTask = {
            ...task,
            id,
            nextRun
        };

        this.tasks.set(id, fullTask);
        void this.operations.run('scheduler-persist', () => this.persistTasks()).catch(() => undefined);

        console.log(`[SCHEDULER] ➕ Scheduled: "${task.name}" - Next run: ${new Date(nextRun).toLocaleString()}`);

        return id;
    }

    /**
     * Schedule a task in natural language format
     * Examples: "tomorrow at 9am", "in 2 hours", "every day at 9am"
     */
    public scheduleNaturalLanguage(description: string, action: ScheduledTask['action']): string | null {
        this.operations.assertWorkAccepted();
        const now = Date.now();
        let executeAt: number | undefined;
        let recurrence: ScheduledTask['recurrence'] | undefined;

        const lowerDesc = description.toLowerCase();

        // Parse "in X hours/minutes"
        const inMatch = lowerDesc.match(/in (\d+) (hour|minute|min|day)s?/);
        if (inMatch) {
            const amount = parseInt(inMatch[1]);
            const unit = inMatch[2];
            const multiplier = unit.startsWith('hour') ? 3600000 :
                unit.startsWith('min') ? 60000 :
                    86400000; // day
            executeAt = now + (amount * multiplier);
        }

        // Parse "every day/week/hour"
        if (lowerDesc.includes('every day')) recurrence = 'DAILY';
        if (lowerDesc.includes('every week')) recurrence = 'WEEKLY';
        if (lowerDesc.includes('every hour')) recurrence = 'HOURLY';
        if (lowerDesc.includes('every month')) recurrence = 'MONTHLY';

        // Parse "at Xam/pm" for hour
        const atMatch = lowerDesc.match(/at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
        if (atMatch) {
            let hour = parseInt(atMatch[1]);
            const minute = parseInt(atMatch[2] || '0');
            const ampm = atMatch[3];

            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;

            const target = new Date();
            target.setHours(hour, minute, 0, 0);

            // If time already passed today, schedule for tomorrow
            if (target.getTime() <= now && !recurrence) {
                target.setDate(target.getDate() + 1);
            }

            executeAt = target.getTime();
        }

        if (!executeAt && !recurrence) {
            console.warn('[SCHEDULER] ⚠️ Could not parse schedule:', description);
            return null;
        }

        return this.scheduleTask({
            name: description,
            description,
            executeAt,
            recurrence,
            action,
            enabled: true,
            createdBy: 'USER'
        });
    }

    /**
     * Cancel a scheduled task
     */
    public cancelTask(taskId: string): boolean {
        this.operations.assertWorkAccepted();
        const deleted = this.tasks.delete(taskId);
        if (deleted) {
            void this.operations.run('scheduler-persist', () => this.persistTasks()).catch(() => undefined);
            console.log(`[SCHEDULER] ❌ Cancelled task: ${taskId}`);
        }
        return deleted;
    }

    /**
     * Get all scheduled tasks
     */
    public getTasks(): ScheduledTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Get upcoming tasks
     */
    public getUpcoming(limit: number = 5): ScheduledTask[] {
        return Array.from(this.tasks.values())
            .filter(t => t.enabled && t.nextRun)
            .sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0))
            .slice(0, limit);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS
    // ═══════════════════════════════════════════════════════════════════════

    private executionAllowed(task?: ScheduledTask): boolean {
        try {
            const config = configLoader.getConfig();
            return config.scheduler?.enabled === true && config.autonomy?.enabled === true
                && (task?.action.type !== 'GOAL_CHECK' || config.autonomy.enableIntrospection === true);
        } catch {
            return false;
        }
    }

    private async checkAndExecuteDueTasks(): Promise<void> {
        if (!this.operations.accepting || this.checking) return;
        if (!this.executionAllowed()) { this.stop(); return; }
        this.checking = true;
        try {
            await this.storageReady;
            const now = Date.now();

            for (const [id, task] of this.tasks) {
                if (!this.operations.accepting || !this.executionAllowed()) break;
                if (!task.enabled || !task.nextRun || !this.executionAllowed(task)) continue;

                if (task.nextRun <= now) {
                    console.log(`[SCHEDULER] 🚀 Executing: "${task.name}"`);

                    // Emit event for execution
                    systemBus.emit(SystemProtocol.SCHEDULED_TASK_TRIGGER, {
                        taskId: id,
                        taskName: task.name,
                        action: task.action
                    }, 'SCHEDULER');

                    // Execute based on action type
                    if (!await this.executeTask(task)) continue;

                    // Update last run
                    task.lastRun = now;

                    // Calculate next run for recurring tasks
                    if (task.recurrence) {
                        task.nextRun = this.calculateNextRun(task);
                        console.log(`[SCHEDULER] 🔄 Next run: ${new Date(task.nextRun).toLocaleString()}`);
                    } else {
                        // One-time task - disable after execution
                        task.enabled = false;
                    }

                    await this.persistTasks();
                }
            }
        } finally {
            this.checking = false;
        }
    }

    private async executeTask(task: ScheduledTask): Promise<boolean> {
        if (!this.executionAllowed(task)) return false;
        try {
            switch (task.action.type) {
                case 'PLAN_EXECUTION':
                    const { planExecutor } = await import('./planExecutor');
                    if (task.action.payload.plan) {
                        await planExecutor.execute(task.action.payload.plan);
                    }
                    break;

                case 'GOAL_CHECK':
                    const { introspection } = await import('./introspectionEngine');
                    await introspection.deriveGoals();
                    break;

                case 'CUSTOM':
                    // Emit custom action via SystemBus for handling
                    systemBus.emit(SystemProtocol.ACTION_INTENT, {
                        actions: [task.action.payload]
                    }, 'SCHEDULER');
                    break;
            }
        } catch (e) {
            console.error(`[SCHEDULER] ❌ Task "${task.name}" failed:`, e);
        }
        return true;
    }

    private calculateNextRun(task: Partial<ScheduledTask>): number {
        const now = Date.now();

        if (task.executeAt && task.executeAt > now) {
            return task.executeAt;
        }

        if (task.recurrence) {
            const base = task.lastRun || now;
            switch (task.recurrence) {
                case 'HOURLY': return base + 3600000;
                case 'DAILY': return base + 86400000;
                case 'WEEKLY': return base + 604800000;
                case 'MONTHLY': return base + 2592000000;
            }
        }

        return now + 60000; // Default: 1 minute from now
    }

    private async loadTasksFromStorage(): Promise<void> {
        try {
            const { sqliteService } = await import('./sqliteService');

            // Use config storage pattern (leveraging existing architecture)
            const storedTasks = sqliteService.getConfig('scheduled_tasks');

            if (storedTasks && Array.isArray(storedTasks)) {
                for (const taskData of storedTasks) {
                    try {
                        const task: ScheduledTask = taskData;
                        this.tasks.set(task.id, task);
                    } catch (e) {
                        console.warn('[SCHEDULER] Failed to parse stored task');
                    }
                }
            }

            console.log(`[SCHEDULER] 📦 Loaded ${this.tasks.size} tasks from storage`);
        } catch (e) {
            this.operations.recordDiagnostic('scheduler-storage-unavailable', e, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
            console.warn('[SCHEDULER] Storage unavailable, using in-memory only');
        }
    }

    private async persistTasks(): Promise<void> {
        try {
            await this.storageReady;
            const { sqliteService } = await import('./sqliteService');

            // Persist as single config value (leveraging existing architecture)
            const tasksArray = Array.from(this.tasks.values());
            sqliteService.setConfig('scheduled_tasks', tasksArray);
        } catch (e) {
            this.operations.recordFailure('scheduler-task-durability', e);
            // Public compatibility keeps tasks in RAM, not a persistence success.
        }
    }
}

// Singleton
export const schedulerService = new SchedulerService();
