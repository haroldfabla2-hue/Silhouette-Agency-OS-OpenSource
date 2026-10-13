/**
 * FactRepository (R5): typed, owner-scoped fact storage with real provenance.
 *
 * Root cause fixed: facts used to live in three divergent places with no
 * shared identity - graph writes could be silently faked by the SQLite
 * fallback, /memory/facts read only the graph while the extractor also wrote
 * Continuum, updates/deletes never reached Continuum, similarity search was
 * not owner-scoped, and the model's declared confidence was accepted without
 * any backing citation.
 *
 * Design (per plan de raices R5):
 * - SQLite `facts` table is the durable source of truth. Rows are never
 *   hard-deleted: retraction sets retracted_at (quarantine, not erasure).
 * - Neo4j and ContinuumMemory are PROJECTIONS addressed by the same fact id
 *   (graph property id, continuum tag `factid:<id>`). Projection failures are
 *   recorded on the receipt, never logged as success.
 * - Every mutation returns a receipt: action, backend results, rows affected.
 * - USER_STATED requires a quote that literally appears in the owner's
 *   message; anything else is stored as a hypothesis (USER_INFERRED).
 */

import crypto from 'crypto';
import { sqliteService } from '../sqliteService';
import { graph } from '../graphService';
import { continuum } from '../continuumMemory';
import { MemoryTier } from '../../types';
import { MemorySource, sourceTag } from './provenance';

export type FactSource = 'USER_STATED' | 'USER_INFERRED' | 'LEGACY';
export type FactStatus = 'verified' | 'hypothesis';

export interface FactRecord {
    id: string;
    ownerId: string;
    type: string;
    content: string;
    subject: string | null;
    attribute: string | null;
    value: string | null;
    source: FactSource;
    quote: string | null;
    status: FactStatus;
    confidence: number;
    createdAt: number;
    updatedAt: number;
    retractedAt: number | null;
}

export interface ProjectionReceipt {
    backend: 'graph' | 'continuum';
    ok: boolean;
    attempts: number;
    detail?: string;
}

export interface FactReceipt {
    id: string;
    action: 'ADD' | 'UPDATE' | 'RETRACT';
    sqliteRows: number;
    projections: ProjectionReceipt[];
}

interface NewFact {
    type: string;
    content: string;
    subject?: string;
    attribute?: string;
    value?: string;
    source: FactSource;
    quote?: string;
    status: FactStatus;
    confidence: number;
}

const PROJECTION_RETRIES = 2; // one immediate retry per projection, then honest failure

class FactRepository {
    /**
     * Add a new fact: SQLite first (durable source), then project to graph and
     * continuum under the same id. Projection failures degrade the receipt,
     * never the truth: reads always come from SQLite.
     */
    async addFact(fact: NewFact, ownerId: string): Promise<FactReceipt> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const result = sqliteService.db.prepare(`
            INSERT INTO facts (id, owner_id, type, content, subject, attribute, value, source, quote, status, confidence, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, ownerId, fact.type, fact.content, fact.subject ?? null, fact.attribute ?? null,
            fact.value ?? null, fact.source, fact.quote ?? null, fact.status, fact.confidence, now, now);

        const projections: ProjectionReceipt[] = [];
        projections.push(await this.projectToGraph(id, fact, ownerId));
        projections.push(await this.projectToContinuum(id, fact, ownerId));

        return { id, action: 'ADD', sqliteRows: result.changes, projections };
    }

    /**
     * Update a fact across SQLite and every projection. Continuum has no
     * update-by-id, so the projection writes a superseding entry under the
     * same factid tag; SQLite remains the only read path, so this can never
     * resurrect stale content into answers.
     */
    async updateFact(id: string, patch: { content: string; value?: string; confidence: number }, ownerId: string): Promise<FactReceipt> {
        const now = Date.now();
        const result = sqliteService.db.prepare(`
            UPDATE facts SET content = ?, value = ?, confidence = ?, updated_at = ?
            WHERE id = ? AND owner_id = ? AND retracted_at IS NULL
        `).run(patch.content, patch.value ?? null, patch.confidence, now, id, ownerId);

        const projections: ProjectionReceipt[] = [];
        if (result.changes > 0) {
            projections.push(await this.tryProjection('graph', async () => {
                await graph.runQuery(`
                    MATCH (f:Fact {id: $id})
                    SET f.content = $content, f.value = $value, f.confidence = $confidence, f.updatedAt = $now
                `, { id, content: patch.content, value: patch.value ?? null, confidence: patch.confidence, now });
            }));
            projections.push(await this.tryProjection('continuum', async () => {
                const row = this.getFact(id, ownerId);
                if (!row) throw new Error(`fact ${id} not found for continuum supersede`);
                await continuum.store(
                    patch.content,
                    MemoryTier.LONG,
                    ['FACT', 'USER', row.type, row.source, `attr:${row.attribute || 'general'}`, `owner:${ownerId}`,
                     `factid:${id}`, 'SUPERSEDES', sourceTag(row.source === 'USER_STATED' ? MemorySource.USER_SAID : MemorySource.ASSISTANT_SAID)]
                );
            }));
        }
        return { id, action: 'UPDATE', sqliteRows: result.changes, projections };
    }

    /**
     * Retract a fact: soft-delete in SQLite (quarantine), hard-remove the
     * graph projection, and mark the continuum projection retracted. The fact
     * disappears from all reads while the evidence row survives.
     */
    async retractFact(id: string, ownerId: string): Promise<FactReceipt> {
        const now = Date.now();
        const result = sqliteService.db.prepare(`
            UPDATE facts SET retracted_at = ? WHERE id = ? AND owner_id = ? AND retracted_at IS NULL
        `).run(now, id, ownerId);

        const projections: ProjectionReceipt[] = [];
        if (result.changes > 0) {
            projections.push(await this.tryProjection('graph', async () => {
                await graph.runQuery(`MATCH (f:Fact {id: $id}) DETACH DELETE f`, { id });
            }));
            projections.push(await this.tryProjection('continuum', async () => {
                const row = this.getFact(id, ownerId, true);
                await continuum.store(
                    `[RETRACTED fact ${id}] ${row?.content ?? ''}`,
                    MemoryTier.LONG,
                    ['FACT', 'RETRACTED', `owner:${ownerId}`, `factid:${id}`, sourceTag(MemorySource.SYSTEM)]
                );
            }));
        }
        return { id, action: 'RETRACT', sqliteRows: result.changes, projections };
    }

    /** Read facts from the durable source. Graph/continuum are never read here. */
    getFacts(ownerId: string, opts: { includeRetracted?: boolean } = {}): FactRecord[] {
        const rows = sqliteService.db.prepare(`
            SELECT * FROM facts WHERE owner_id = ? ${opts.includeRetracted ? '' : 'AND retracted_at IS NULL'}
            ORDER BY created_at DESC
        `).all(ownerId) as any[];
        return rows.map(r => this.toRecord(r));
    }

    getFact(id: string, ownerId: string, includeRetracted = false): FactRecord | null {
        const r = sqliteService.db.prepare(`
            SELECT * FROM facts WHERE id = ? AND owner_id = ? ${includeRetracted ? '' : 'AND retracted_at IS NULL'}
        `).get(id, ownerId) as any;
        return r ? this.toRecord(r) : null;
    }

    /** Owner-scoped similarity search (previously unscoped across users). */
    findSimilar(fact: { attribute?: string; subject?: string; value?: string }, ownerId: string): FactRecord[] {
        const rows = sqliteService.db.prepare(`
            SELECT * FROM facts
            WHERE owner_id = ? AND retracted_at IS NULL
              AND (attribute = ? OR content LIKE ?)
            LIMIT 5
        `).all(ownerId, fact.attribute || '', `%${fact.subject || fact.value || ''}%`) as any[];
        return rows.map(r => this.toRecord(r));
    }

    /**
     * Quarantine import: legacy facts that only exist in the graph fallback
     * tables are copied into the repository as hypotheses with source LEGACY.
     * Nothing is deleted; unverifiable history stays visible but downgraded.
     * Returns the number of facts imported.
     */
    importLegacyFacts(ownerId: string): number {
        const legacy = sqliteService.db.prepare(`SELECT id, properties FROM graph_nodes WHERE label = 'Fact'`).all() as any[];
        let imported = 0;
        const insert = sqliteService.db.prepare(`
            INSERT OR IGNORE INTO facts (id, owner_id, type, content, subject, attribute, value, source, quote, status, confidence, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'LEGACY', NULL, 'hypothesis', ?, ?, ?)
        `);
        for (const row of legacy) {
            let props: any = {};
            try { props = JSON.parse(row.properties); } catch { continue; }
            if (!props.content) continue;
            const created = typeof props.createdAt === 'number' ? props.createdAt : Date.now();
            const r = insert.run(row.id, ownerId, props.type || 'FACT', props.content,
                props.subject ?? null, props.attribute ?? null, props.value ?? null,
                typeof props.confidence === 'number' ? props.confidence : 0.5, created, created);
            imported += r.changes;
        }
        return imported;
    }

    private async projectToGraph(id: string, fact: NewFact, ownerId: string): Promise<ProjectionReceipt> {
        return this.tryProjection('graph', async () => {
            await graph.runQuery(`
                CREATE (f:Fact {
                    id: $id, type: $type, content: $content, subject: $subject,
                    attribute: $attribute, value: $value, confidence: $confidence,
                    createdAt: $now, source: $source, status: $status
                })
            `, {
                id, type: fact.type, content: fact.content, subject: fact.subject ?? null,
                attribute: fact.attribute ?? null, value: fact.value ?? null,
                confidence: fact.confidence, now: Date.now(), source: fact.source, status: fact.status
            });
            if (fact.type === 'PERSONAL' || fact.type === 'PREFERENCE') {
                await graph.runQuery(`
                    MERGE (u:User {id: $userId})
                    WITH u
                    MATCH (f:Fact {id: $factId})
                    MERGE (u)-[:HAS_FACT]->(f)
                `, { userId: ownerId, factId: id });
            }
        });
    }

    private async projectToContinuum(id: string, fact: NewFact, ownerId: string): Promise<ProjectionReceipt> {
        return this.tryProjection('continuum', async () => {
            await continuum.store(
                fact.content,
                MemoryTier.LONG,
                ['FACT', 'USER', fact.type, fact.source, `attr:${fact.attribute || 'general'}`, `owner:${ownerId}`,
                 `factid:${id}`, sourceTag(fact.source === 'USER_STATED' ? MemorySource.USER_SAID : MemorySource.ASSISTANT_SAID)]
            );
        });
    }

    private async tryProjection(backend: 'graph' | 'continuum', fn: () => Promise<void>): Promise<ProjectionReceipt> {
        let lastError: any = null;
        for (let attempt = 1; attempt <= PROJECTION_RETRIES; attempt++) {
            try {
                await fn();
                return { backend, ok: true, attempts: attempt };
            } catch (e: any) {
                lastError = e;
            }
        }
        console.warn(`[FACT_REPO] ⚠️ ${backend} projection failed after ${PROJECTION_RETRIES} attempts:`, lastError?.message || lastError);
        return { backend, ok: false, attempts: PROJECTION_RETRIES, detail: String(lastError?.message || lastError) };
    }

    private toRecord(r: any): FactRecord {
        return {
            id: r.id, ownerId: r.owner_id, type: r.type, content: r.content,
            subject: r.subject, attribute: r.attribute, value: r.value,
            source: r.source, quote: r.quote, status: r.status,
            confidence: r.confidence, createdAt: r.created_at, updatedAt: r.updated_at,
            retractedAt: r.retracted_at
        };
    }
}

export const factRepository = new FactRepository();
