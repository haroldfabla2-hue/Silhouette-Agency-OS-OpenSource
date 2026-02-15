/**
 * DISCOVERY JOURNAL SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Persistent memory for ALL discovery decisions.
 * Enables Silhouette to learn from past discoveries and avoid repeating mistakes.
 */

import { v4 as uuidv4 } from 'uuid';
import { sqliteService } from './sqliteService';

export type DiscoveryDecision = 'ACCEPT' | 'REFINE' | 'DEFER' | 'REJECT';
export type FinalOutcome = 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'SUPERSEDED';

export interface DiscoveryEntry {
    id: string;
    timestamp: number;
    sourceNode: string;
    targetNode: string;
    decision: DiscoveryDecision;
    confidence: number;
    feedback: string;
    refinementHint?: string;
    relationType?: string;
    retryCount: number;
    finalOutcome: FinalOutcome;
    discoverySource: string;
    metadata?: Record<string, any>;
}

class DiscoveryJournalService {
    private db: any;

    constructor() {
        // Access the underlying SQLite database
        this.db = (sqliteService as any).db;
    }

    /**
     * Log a discovery decision to the journal
     */
    public logDecision(entry: Omit<DiscoveryEntry, 'id' | 'timestamp' | 'retryCount' | 'finalOutcome'>): string {
        const id = uuidv4();
        const timestamp = Date.now();

        // Check if this pair has been evaluated before
        const existingCount = this.getRetryCount(entry.sourceNode, entry.targetNode);

        const stmt = this.db.prepare(`
            INSERT INTO discovery_journal 
            (id, timestamp, source_node, target_node, decision, confidence, feedback, 
             refinement_hint, relation_type, retry_count, final_outcome, discovery_source, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const finalOutcome = entry.decision === 'ACCEPT' ? 'ACCEPTED'
            : entry.decision === 'REJECT' ? 'REJECTED'
                : 'PENDING';

        stmt.run(
            id,
            timestamp,
            entry.sourceNode,
            entry.targetNode,
            entry.decision,
            entry.confidence,
            entry.feedback || '',
            entry.refinementHint || null,
            entry.relationType || null,
            existingCount + 1,
            finalOutcome,
            entry.discoverySource,
            entry.metadata ? JSON.stringify(entry.metadata) : null
        );

        console.log(`[JOURNAL] 📝 Logged ${entry.decision}: ${entry.sourceNode} → ${entry.targetNode}`);
        return id;
    }

    /**
     * Check if a connection has been previously rejected
     */
    public wasRejected(sourceNode: string, targetNode: string): boolean {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM discovery_journal 
            WHERE ((source_node = ? AND target_node = ?) OR (source_node = ? AND target_node = ?))
            AND decision = 'REJECT'
        `);
        const result = stmt.get(sourceNode, targetNode, targetNode, sourceNode);
        return result.count > 0;
    }

    /**
     * Check if a connection has been previously accepted
     */
    public wasAccepted(sourceNode: string, targetNode: string): boolean {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM discovery_journal 
            WHERE ((source_node = ? AND target_node = ?) OR (source_node = ? AND target_node = ?))
            AND decision = 'ACCEPT'
        `);
        const result = stmt.get(sourceNode, targetNode, targetNode, sourceNode);
        return result.count > 0;
    }

    /**
     * Get retry count for a node pair
     */
    public getRetryCount(sourceNode: string, targetNode: string): number {
        const stmt = this.db.prepare(`
            SELECT MAX(retry_count) as max_retry FROM discovery_journal 
            WHERE (source_node = ? AND target_node = ?) OR (source_node = ? AND target_node = ?)
        `);
        const result = stmt.get(sourceNode, targetNode, targetNode, sourceNode);
        return result.max_retry || 0;
    }

    /**
     * Get pending REFINE entries that need follow-up
     */
    public getPendingRefinements(limit: number = 10): DiscoveryEntry[] {
        const stmt = this.db.prepare(`
            SELECT * FROM discovery_journal 
            WHERE decision = 'REFINE' AND final_outcome = 'PENDING'
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        const rows = stmt.all(limit);
        return rows.map(this.mapRowToEntry);
    }

    /**
     * Get deferred entries ready for retry
     */
    public getDeferredReadyForRetry(): DiscoveryEntry[] {
        const stmt = this.db.prepare(`
            SELECT * FROM discovery_journal 
            WHERE decision = 'DEFER' AND final_outcome = 'PENDING'
            ORDER BY timestamp ASC
        `);
        const rows = stmt.all();
        return rows.map(this.mapRowToEntry);
    }

    /**
     * Update final outcome of a discovery
     */
    public updateOutcome(sourceNode: string, targetNode: string, outcome: FinalOutcome): void {
        const stmt = this.db.prepare(`
            UPDATE discovery_journal 
            SET final_outcome = ?
            WHERE ((source_node = ? AND target_node = ?) OR (source_node = ? AND target_node = ?))
            AND final_outcome = 'PENDING'
        `);
        stmt.run(outcome, sourceNode, targetNode, targetNode, sourceNode);
        console.log(`[JOURNAL] 📝 Updated outcome: ${sourceNode} → ${targetNode} = ${outcome}`);
    }

    /**
     * Get discovery history for a node
     */
    public getHistoryForNode(nodeId: string, limit: number = 50): DiscoveryEntry[] {
        const stmt = this.db.prepare(`
            SELECT * FROM discovery_journal 
            WHERE source_node = ? OR target_node = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        const rows = stmt.all(nodeId, nodeId, limit);
        return rows.map(this.mapRowToEntry);
    }

    /**
     * Get recent discoveries across all nodes
     */
    public getRecentDiscoveries(limit: number = 100): DiscoveryEntry[] {
        const stmt = this.db.prepare(`
            SELECT * FROM discovery_journal 
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        const rows = stmt.all(limit);
        return rows.map(this.mapRowToEntry);
    }

    /**
     * Get discovery statistics
     */
    public getStats(): { total: number; accepted: number; rejected: number; pending: number } {
        const stmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN decision = 'ACCEPT' THEN 1 ELSE 0 END) as accepted,
                SUM(CASE WHEN decision = 'REJECT' THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN final_outcome = 'PENDING' THEN 1 ELSE 0 END) as pending
            FROM discovery_journal
        `);
        return stmt.get();
    }

    private mapRowToEntry(row: any): DiscoveryEntry {
        return {
            id: row.id,
            timestamp: row.timestamp,
            sourceNode: row.source_node,
            targetNode: row.target_node,
            decision: row.decision,
            confidence: row.confidence,
            feedback: row.feedback,
            refinementHint: row.refinement_hint,
            relationType: row.relation_type,
            retryCount: row.retry_count,
            finalOutcome: row.final_outcome,
            discoverySource: row.discovery_source,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined
        };
    }
}

export const discoveryJournal = new DiscoveryJournalService();
