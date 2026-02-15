/**
 * MEMORY INSPECTOR - Lists all facts and memories
 */
import { graph } from '../services/graphService.js';

async function inspect() {
    console.log("=== MEMORY INSPECTOR ===\n");

    // 1. Neo4j Facts
    console.log("[1] NEO4J FACTS:");
    try {
        const countResult = await graph.runQuery('MATCH (f:Fact) RETURN count(f) as total');
        const total = countResult?.[0]?.total || 0;
        console.log(`   Total Facts: ${total}`);

        if (total > 0) {
            const facts = await graph.runQuery('MATCH (f:Fact) RETURN f.id as id, f.content as content ORDER BY f.createdAt DESC LIMIT 100');
            console.log("\n   --- All Facts (max 100) ---");
            facts.forEach((f: any, i: number) => {
                console.log(`   ${i + 1}. [${f.id?.substring(0, 8)}] ${f.content}`);
            });
        }
    } catch (e: any) {
        console.log("   Error connecting to Neo4j:", e.message);
    }

    // 2. Check for corrupted patterns
    console.log("\n[2] CHECKING FOR CORRUPTED PATTERNS:");
    try {
        const corrupted = await graph.runQuery(`
            MATCH (f:Fact) 
            WHERE f.content =~ '(?i).*usuario.*(indica|dice).*es.*silhouette.*'
               OR f.content =~ '(?i).*usuario.*prefiere.*ser.*llamado.*(sil|silu).*'
               OR f.content =~ '(?i).*soy silhouette.*'
            RETURN f.id as id, f.content as content
        `);

        if (corrupted && corrupted.length > 0) {
            console.log(`   👹 Found ${corrupted.length} CORRUPTED memories:`);
            corrupted.forEach((f: any, i: number) => {
                console.log(`   ${i + 1}. [CORRUPT] ${f.content}`);
            });
        } else {
            console.log("   ✅ No corrupted patterns found in Neo4j.");
        }
    } catch (e: any) {
        console.log("   Error checking patterns:", e.message);
    }

    console.log("\n=== INSPECTION COMPLETE ===");
    process.exit(0);
}

inspect().catch(console.error);
