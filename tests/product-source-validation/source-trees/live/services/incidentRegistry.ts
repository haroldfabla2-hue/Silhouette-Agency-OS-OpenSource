/**
 * IncidentRegistry (R6): the single durable channel for system incidents.
 *
 * Root cause fixed: backend failures (Neo4j connection exhaustion, Redis
 * fallback) were written to the console and nowhere else; the self-healing
 * task read a log file whose absence it reported as "healthy"; and the
 * narrator's perception silently mapped every failure to "zero incidents".
 * Console output is ephemeral - nothing downstream could ever perceive it.
 *
 * Contract:
 * - Producers RECORD: one open incident per (source, kind, summary); repeats
 *   bump occurrence_count/last_seen instead of spamming rows.
 * - Recovery RESOLVES: a recovered backend closes its own open incidents, so
 *   an outage and its recovery are the same incident, never two narratives.
 * - Consumers READ: narrator, self-healing and the UI diagnostics endpoint
 *   all see the same durable truth. An empty result means "zero incidents",
 *   and a source that cannot even be read is declared unavailable by the
 *   consumer - the two states are never conflated again.
 *
 * SQLite is the durable store: synchronous, always available locally, no
 * dependency on the backends whose failures are being recorded.
 */

import crypto from 'crypto';
import { sqliteService } from './sqliteService';

export type IncidentKind = 'outage' | 'error' | 'perception_gap';

export interface Incident {
    id: string;
    source: string;
    kind: IncidentKind;
    summary: string;
    detail: string | null;
    status: 'open' | 'resolved';
    occurrenceCount: number;
    firstSeen: number;
    lastSeen: number;
    resolvedAt: number | null;
}

class IncidentRegistry {
    /**
     * Record an incident. If the same (source, kind, summary) is already open,
     * bump its occurrence count - one outage episode is one incident.
     */
    recordIncident(source: string, kind: IncidentKind, summary: string, detail?: string): { id: string; created: boolean } {
        const now = Date.now();
        const existing = sqliteService.db.prepare(
            `SELECT id, occurrence_count FROM incidents WHERE source = ? AND kind = ? AND summary = ? AND status = 'open'`
        ).get(source, kind, summary) as any;

        if (existing) {
            sqliteService.db.prepare(
                `UPDATE incidents SET occurrence_count = occurrence_count + 1, last_seen = ? WHERE id = ?`
            ).run(now, existing.id);
            return { id: existing.id, created: false };
        }

        const id = crypto.randomUUID();
        sqliteService.db.prepare(`
            INSERT INTO incidents (id, source, kind, summary, detail, status, occurrence_count, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, 'open', 1, ?, ?)
        `).run(id, source, kind, summary, detail ?? null, now, now);
        console.warn(`[INCIDENTS] 🚨 open ${source}/${kind}: ${summary}`);
        return { id, created: true };
    }

    /**
     * Resolve open incidents for a source (optionally one kind). Returns the
     * number closed - recovery closes the SAME incident the outage opened.
     */
    resolveIncidents(source: string, kind?: IncidentKind): number {
        const now = Date.now();
        const result = kind
            ? sqliteService.db.prepare(
                `UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE source = ? AND kind = ? AND status = 'open'`
            ).run(now, source, kind)
            : sqliteService.db.prepare(
                `UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE source = ? AND status = 'open'`
            ).run(now, source);
        if (result.changes > 0) {
            console.log(`[INCIDENTS] ✅ resolved ${result.changes} incident(s) for ${source}${kind ? `/${kind}` : ''}`);
        }
        return result.changes;
    }

    getOpenIncidents(): Incident[] {
        const rows = sqliteService.db.prepare(
            `SELECT * FROM incidents WHERE status = 'open' ORDER BY last_seen DESC`
        ).all() as any[];
        return rows.map(r => this.toIncident(r));
    }

    getRecentIncidents(limit = 20): Incident[] {
        const rows = sqliteService.db.prepare(
            `SELECT * FROM incidents ORDER BY last_seen DESC LIMIT ?`
        ).all(limit) as any[];
        return rows.map(r => this.toIncident(r));
    }

    private toIncident(r: any): Incident {
        return {
            id: r.id, source: r.source, kind: r.kind, summary: r.summary,
            detail: r.detail, status: r.status, occurrenceCount: r.occurrence_count,
            firstSeen: r.first_seen, lastSeen: r.last_seen, resolvedAt: r.resolved_at
        };
    }
}

export const incidentRegistry = new IncidentRegistry();
