import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { QdrantClient } from '@qdrant/js-client-rest';
import { getDatabaseAdapter } from '../services/database/adapterFactory';
import { MemoryNode, MemoryTier } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env.local') });
dotenv.config({ path: path.join(projectRoot, '.env.server') });
dotenv.config({ path: path.join(projectRoot, '.env') });

function toMemoryNode(id: string, payload: Record<string, any>): MemoryNode {
    const timestamp = payload.timestamp || Date.now();
    return {
        id,
        content: payload.content || '',
        originalContent: payload.originalContent,
        timestamp,
        tier: payload.tier || MemoryTier.DEEP,
        importance: payload.importance ?? 0.5,
        tags: payload.tags || [],
        accessCount: payload.accessCount || 0,
        lastAccess: payload.lastAccess || timestamp,
        decayHealth: payload.decayHealth,
        compressionLevel: payload.compressionLevel,
        ownerId: payload.ownerId,
        nestingLevel: payload.nestingLevel,
        stabilityScore: payload.stabilityScore,
        raptorLevel: payload.raptorLevel,
        timeGrid: payload.timeGrid,
        ...(payload.source ? { source: payload.source } : {}),
        ...(payload.category || payload.type ? { category: payload.category || payload.type } : {}),
        metadata: payload
    } as MemoryNode;
}

function normalizeVector(vector: any): number[] | undefined {
    if (Array.isArray(vector)) return vector;
    if (vector && typeof vector === 'object') {
        const firstNamedVector = Object.values(vector)[0];
        if (Array.isArray(firstNamedVector)) return firstNamedVector as number[];
    }
    return undefined;
}

async function main() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required for pgvector migration.');
    }

    const qdrantUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
    const collectionName = process.env.QDRANT_COLLECTION || 'silhouette_memory_v1';

    const qdrant = new QdrantClient({
        url: qdrantUrl,
        checkCompatibility: false
    });

    const adapter = await getDatabaseAdapter();

    let collectionInfo: any;
    try {
        collectionInfo = await qdrant.getCollection(collectionName);
    } catch (error: any) {
        console.log(`[MIGRATE] Source collection not available: ${collectionName}`);
        return;
    }

    const pointsCount = collectionInfo?.points_count || 0;
    if (pointsCount === 0) {
        console.log(`[MIGRATE] Qdrant collection ${collectionName} is empty. Nothing to migrate.`);
        return;
    }

    console.log(`[MIGRATE] Migrating ${pointsCount} Qdrant points to pgvector...`);

    let offset: any = undefined;
    let migrated = 0;

    while (true) {
        const result = await qdrant.scroll(collectionName, {
            limit: 100,
            offset,
            with_payload: true,
            with_vector: true
        });

        for (const point of result.points || []) {
            const payload = (point.payload || {}) as Record<string, any>;
            const node = toMemoryNode(String(point.id), payload);
            const vector = normalizeVector((point as any).vector);
            await adapter.storeVector(node, vector);
            migrated += 1;
        }

        if (!result.next_page_offset) break;
        offset = result.next_page_offset;
    }

    console.log(`[MIGRATE] Done. ${migrated} points migrated to pgvector.`);
}

main().catch((error) => {
    console.error('[MIGRATE] Migration failed:', error);
    process.exit(1);
});
