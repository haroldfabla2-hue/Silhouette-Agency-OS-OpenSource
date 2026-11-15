import { graph } from '../services/graphService';

/**
 * Neo4j Index Initialization Script
 * Creates indexes for optimal query performance on hub strengthening and pruning operations.
 * 
 * Run this once after Neo4j setup:
 *   npx ts-node scripts/init_neo4j_indexes.ts
 */

async function initializeIndexes() {
    console.log('[NEO4J] 🔧 Creating performance indexes...');

    const indexes = [
        // Relationship property indexes for pruning queries
        {
            name: 'idx_rel_lastAccessed',
            query: `CREATE INDEX idx_rel_lastAccessed IF NOT EXISTS FOR ()-[r:RELATED]-() ON (r.lastAccessed)`,
            purpose: 'Pruning cycle decay queries'
        },
        {
            name: 'idx_rel_weight',
            query: `CREATE INDEX idx_rel_weight IF NOT EXISTS FOR ()-[r:RELATED]-() ON (r.weight)`,
            purpose: 'Pruning cycle removal queries'
        },
        // Node property indexes for hub detection
        {
            name: 'idx_node_id',
            query: `CREATE INDEX idx_node_id IF NOT EXISTS FOR (n:Concept) ON (n.id)`,
            purpose: 'Fast node lookup by ID'
        },
        {
            name: 'idx_node_label',
            query: `CREATE INDEX idx_node_label IF NOT EXISTS FOR (n:Concept) ON (n.label)`,
            purpose: 'Fast node lookup by label'
        },
        // Full-text search index for semantic queries
        {
            name: 'idx_node_content_fulltext',
            query: `CREATE FULLTEXT INDEX idx_node_content_fulltext IF NOT EXISTS FOR (n:Concept) ON EACH [n.content]`,
            purpose: 'Full-text search on node content'
        }
    ];

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const idx of indexes) {
        try {
            await graph.runQuery(idx.query, {});
            console.log(`  ✅ ${idx.name}: ${idx.purpose}`);
            successCount++;
        } catch (e: any) {
            if (e.message?.includes('already exists') || e.message?.includes('equivalent')) {
                console.log(`  ⏭️  ${idx.name}: Already exists (skipped)`);
                skipCount++;
            } else {
                console.error(`  ❌ ${idx.name}: ${e.message}`);
                errorCount++;
            }
        }
    }

    console.log('\n[NEO4J] Index initialization complete:');
    console.log(`  Created: ${successCount}`);
    console.log(`  Skipped: ${skipCount}`);
    console.log(`  Errors:  ${errorCount}`);

    // Show existing indexes
    try {
        const existingIndexes = await graph.runQuery('SHOW INDEXES', {});
        console.log(`\n[NEO4J] Total indexes in database: ${existingIndexes.length}`);
    } catch {
        // Older Neo4j versions may not support SHOW INDEXES
    }
}

// Run if executed directly
initializeIndexes()
    .then(() => {
        console.log('\n[NEO4J] ✅ Done');
        process.exit(0);
    })
    .catch((e) => {
        console.error('\n[NEO4J] ❌ Fatal error:', e);
        process.exit(1);
    });
