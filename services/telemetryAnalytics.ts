/**
 * Silhouette Agency OS — Anonymous Opt-In Telemetry SDK
 * 
 * Privacy-First Architecture:
 * - NEVER collects PII (emails, names, file paths, chat content)
 * - Anonymous UUID generated locally, not linked to any identity
 * - All data buffered locally in SQLite before optional transmission
 * - User can view, export, and delete all collected data at any time
 * - No-op when user has not opted in
 */

import { v4 as uuidv4 } from 'uuid';
import { sqliteService } from './sqliteService.js';
import os from 'os';

// ─── Types ──────────────────────────────────────────────

interface AnalyticsEvent {
    id: string;
    anonymousId: string;
    event: string;
    properties: Record<string, string | number | boolean>;
    appVersion: string;
    platform: string;
    arch: string;
    timestamp: string;
    flushed: boolean;
}

interface ConsentState {
    optedIn: boolean;
    consentDate: string | null;
    anonymousId: string;
}

// ─── Allowed Events (whitelist) ─────────────────────────

const ALLOWED_EVENTS = new Set([
    'app.launched',
    'app.closed',
    'session.duration',
    'feature.used',
    'hardware.profile',
    'setup.completed',
    'setup.step_completed',
    'error.crash',
    'tour.completed',
    'tour.skipped',
    'model.selected',
    'channel.connected',
]);

// ─── SDK Implementation ────────────────────────────────

class AnonymousTelemetry {
    private anonymousId: string = '';
    private optedIn: boolean = false;
    private appVersion: string = '2.2.0';
    private initialized: boolean = false;
    private flushInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * Initialize the telemetry SDK. Reads consent state from SQLite.
     * Creates the analytics_events table if it doesn't exist.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure analytics tables exist
            this.ensureSchema();

            // Load consent state
            const consent = this.loadConsent();
            this.optedIn = consent.optedIn;
            this.anonymousId = consent.anonymousId;

            // Start periodic flush (every 5 minutes)
            this.flushInterval = setInterval(() => this.flush(), 5 * 60 * 1000);

            this.initialized = true;
            console.log(`[Telemetry] Initialized. Opted-in: ${this.optedIn}`);
        } catch (err) {
            console.error('[Telemetry] Failed to initialize:', (err as Error).message);
        }
    }

    /**
     * Create analytics tables in SQLite if they don't exist.
     */
    private ensureSchema(): void {
        const db = sqliteService.db;
        if (!db) return;

        db.exec(`
            CREATE TABLE IF NOT EXISTS analytics_events (
                id TEXT PRIMARY KEY,
                anonymous_id TEXT NOT NULL,
                event TEXT NOT NULL,
                properties TEXT DEFAULT '{}',
                app_version TEXT NOT NULL,
                platform TEXT NOT NULL,
                arch TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                flushed INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS analytics_consent (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                opted_in INTEGER DEFAULT 0,
                consent_date TEXT,
                anonymous_id TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_analytics_flushed 
                ON analytics_events(flushed);
            CREATE INDEX IF NOT EXISTS idx_analytics_timestamp 
                ON analytics_events(timestamp);
        `);
    }

    /**
     * Load or create consent state.
     */
    private loadConsent(): ConsentState {
        const db = sqliteService.db;
        if (!db) {
            return { optedIn: false, consentDate: null, anonymousId: uuidv4() };
        }

        const row = db.prepare('SELECT * FROM analytics_consent WHERE id = 1').get() as any;

        if (!row) {
            const newId = uuidv4();
            db.prepare(
                'INSERT INTO analytics_consent (id, opted_in, consent_date, anonymous_id) VALUES (1, 0, NULL, ?)'
            ).run(newId);
            return { optedIn: false, consentDate: null, anonymousId: newId };
        }

        return {
            optedIn: row.opted_in === 1,
            consentDate: row.consent_date,
            anonymousId: row.anonymous_id,
        };
    }

    /**
     * Track an analytics event. No-op if user has not opted in.
     * Only whitelisted event names are accepted.
     */
    track(event: string, properties: Record<string, string | number | boolean> = {}): void {
        if (!this.optedIn || !this.initialized) return;
        if (!ALLOWED_EVENTS.has(event)) {
            console.warn(`[Telemetry] Rejected unknown event: ${event}`);
            return;
        }

        // Sanitize properties — remove anything that looks like PII
        const safeProps = this.sanitizeProperties(properties);

        const db = sqliteService.db;
        if (!db) return;

        try {
            db.prepare(`
                INSERT INTO analytics_events 
                (id, anonymous_id, event, properties, app_version, platform, arch, timestamp, flushed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            `).run(
                uuidv4(),
                this.anonymousId,
                event,
                JSON.stringify(safeProps),
                this.appVersion,
                process.platform,
                process.arch,
                new Date().toISOString()
            );
        } catch (err) {
            console.error('[Telemetry] Failed to track event:', (err as Error).message);
        }
    }

    /**
     * Remove any property values that look like PII.
     */
    private sanitizeProperties(
        props: Record<string, string | number | boolean>
    ): Record<string, string | number | boolean> {
        const safe: Record<string, string | number | boolean> = {};
        const piiPatterns = [
            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,  // email
            /\b[A-Za-z]:\\[^\s]+/,                                // Windows file path
            new RegExp('/(?:home|Users)/[^\\s]+'),                 // Unix file path
            /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/,                   // Bearer token
            /\b(?:sk-|pk-|api[_-]?key)[a-zA-Z0-9]{10,}/,         // API key
        ];

        for (const [key, value] of Object.entries(props)) {
            if (typeof value === 'string') {
                const hasPII = piiPatterns.some(pattern => pattern.test(value));
                if (!hasPII && value.length <= 200) {
                    safe[key] = value;
                } else {
                    safe[key] = '[REDACTED]';
                }
            } else {
                safe[key] = value;
            }
        }
        return safe;
    }

    /**
     * Update user consent. When opting out, all local data is purged.
     */
    async setConsent(optedIn: boolean): Promise<void> {
        const db = sqliteService.db;
        if (!db) return;

        this.optedIn = optedIn;

        db.prepare(
            'UPDATE analytics_consent SET opted_in = ?, consent_date = ? WHERE id = 1'
        ).run(optedIn ? 1 : 0, new Date().toISOString());

        if (!optedIn) {
            // Purge all collected data when opting out
            this.purgeAllData();
        }

        console.log(`[Telemetry] Consent updated: ${optedIn ? 'opted-in' : 'opted-out'}`);
    }

    /**
     * Get current consent state.
     */
    getConsent(): ConsentState {
        return {
            optedIn: this.optedIn,
            consentDate: this.loadConsent().consentDate,
            anonymousId: this.anonymousId,
        };
    }

    /**
     * Get all locally buffered events (for the privacy dashboard).
     */
    getBufferedEvents(limit: number = 100): AnalyticsEvent[] {
        const db = sqliteService.db;
        if (!db) return [];

        try {
            const rows = db.prepare(
                'SELECT * FROM analytics_events ORDER BY timestamp DESC LIMIT ?'
            ).all(limit) as any[];

            return rows.map(row => ({
                id: row.id,
                anonymousId: row.anonymous_id,
                event: row.event,
                properties: JSON.parse(row.properties || '{}'),
                appVersion: row.app_version,
                platform: row.platform,
                arch: row.arch,
                timestamp: row.timestamp,
                flushed: row.flushed === 1,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Get event count summary by event name.
     */
    getEventSummary(): Record<string, number> {
        const db = sqliteService.db;
        if (!db) return {};

        try {
            const rows = db.prepare(
                'SELECT event, COUNT(*) as count FROM analytics_events GROUP BY event ORDER BY count DESC'
            ).all() as any[];

            const summary: Record<string, number> = {};
            for (const row of rows) {
                summary[row.event] = row.count;
            }
            return summary;
        } catch {
            return {};
        }
    }

    /**
     * Flush buffered events to the telemetry endpoint.
     * Currently stores locally — ready for future remote transmission.
     */
    async flush(): Promise<number> {
        if (!this.optedIn) return 0;

        const db = sqliteService.db;
        if (!db) return 0;

        try {
            const unflushed = db.prepare(
                'SELECT COUNT(*) as count FROM analytics_events WHERE flushed = 0'
            ).get() as any;

            if (unflushed.count === 0) return 0;

            // Mark events as flushed (local-only for now)
            // When a remote endpoint is configured, events would be POSTed here
            db.prepare('UPDATE analytics_events SET flushed = 1 WHERE flushed = 0').run();

            console.log(`[Telemetry] Flushed ${unflushed.count} events locally.`);
            return unflushed.count;
        } catch (err) {
            console.error('[Telemetry] Flush failed:', (err as Error).message);
            return 0;
        }
    }

    /**
     * Permanently delete all collected analytics data.
     */
    purgeAllData(): void {
        const db = sqliteService.db;
        if (!db) return;

        try {
            db.prepare('DELETE FROM analytics_events').run();
            console.log('[Telemetry] All analytics data purged.');
        } catch (err) {
            console.error('[Telemetry] Purge failed:', (err as Error).message);
        }
    }

    /**
     * Track a convenience hardware profile event.
     */
    trackHardwareProfile(): void {
        const totalMemGB = Math.round(os.totalmem() / (1024 ** 3));
        let ramTier: string;
        if (totalMemGB <= 8) ramTier = '4-8GB';
        else if (totalMemGB <= 16) ramTier = '8-16GB';
        else if (totalMemGB <= 32) ramTier = '16-32GB';
        else ramTier = '32GB+';

        this.track('hardware.profile', {
            cpuCores: os.cpus().length,
            ramTier,
            platform: process.platform,
            arch: process.arch,
        });
    }

    /**
     * Graceful shutdown — flush remaining events.
     */
    async shutdown(): Promise<void> {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        await this.flush();
        console.log('[Telemetry] Shutdown complete.');
    }
}

export const telemetryAnalytics = new AnonymousTelemetry();
