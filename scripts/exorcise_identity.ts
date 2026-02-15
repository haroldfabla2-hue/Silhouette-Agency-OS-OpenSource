/**
 * IDENTITY EXORCISM SCRIPT V2
 * 
 * Comprehensive cleanup of corrupted identity memories.
 * Detects patterns in BOTH English and Spanish.
 */
import { graph } from '../services/graphService.js';

// IDs of facts to DELETE (manually identified from inspection + regex)
const CORRUPTED_FACT_IDS = [
    '374f5a0c', // "Silu para referirte al usuario" - WRONG
    '6537adec', // "My name is Silhouette, not Alberto" - Confusing
    '85d754df', // "you prefer to be called Beto or Silhouette, Assistant" - INVERTED
    'c3a20d1c', // "Te prefieres... Silhouette" - WRONG
    '7e61b69c', // "I am Alberto and my creator is unknown" - COMPLETELY WRONG
    'd526a552', // "My existence is not based on a human creation" - Confabulation
    '5328e1bc', // "Tú eres Silhouette, pero a mi me gusta llamara Sil" - CONFUSED
    // Wave 2 - Additional corrupted
    'a868773a', // "Hola, Alberto. Te llamas Alberto." - Redundant/no context
    'df3a6f85', // "You call me Beto or Silhouette" - INVERTED (Silhouette is NOT Beto)
    'b7d77438', // "My favorite color is purple, I'm colorblind" - Perspective confused (user said this)
];

// Regex patterns for additional detection (English + Spanish)
const CORRUPTED_PATTERNS_REGEX = `
    f.content =~ '(?i).*I am Alberto.*'
    OR f.content =~ '(?i).*yo soy alberto.*' 
    OR f.content =~ '(?i).*my name is silhouette.*'
    OR f.content =~ '(?i).*usuario.*(sil|silu).*'
    OR f.content =~ '(?i).*you prefer.*silhouette.*'
    OR f.content =~ '(?i).*te prefieres.*silhouette.*'
    OR f.content =~ '(?i).*I am Silhouette.*my creator.*'
    OR f.content =~ '(?i).*usuario.*indica.*es.*silhouette.*'
`;

async function exorcise() {
    console.log("🧹 IDENTITY EXORCISM V2\n");
    console.log("=".repeat(50));

    let deletedCount = 0;

    // 1. Delete by known IDs
    console.log("\n[1] DELETING KNOWN CORRUPTED FACTS BY ID...");
    for (const shortId of CORRUPTED_FACT_IDS) {
        try {
            const result = await graph.runQuery(`
                MATCH (f:Fact)
                WHERE f.id STARTS WITH $shortId
                RETURN f.id as id, f.content as content
            `, { shortId });

            if (result && result.length > 0) {
                for (const fact of result) {
                    console.log(`   🔥 DELETING: "${fact.content.substring(0, 60)}..."`);
                    await graph.runQuery(`MATCH (f:Fact {id: $id}) DETACH DELETE f`, { id: fact.id });
                    deletedCount++;
                }
            }
        } catch (e: any) {
            console.log(`   ⚠️ Error with ${shortId}: ${e.message}`);
        }
    }

    // 2. Delete by regex patterns
    console.log("\n[2] SCANNING FOR ADDITIONAL CORRUPTED PATTERNS...");
    try {
        const corrupted = await graph.runQuery(`
            MATCH (f:Fact) 
            WHERE ${CORRUPTED_PATTERNS_REGEX}
            RETURN f.id as id, f.content as content
        `);

        if (corrupted && corrupted.length > 0) {
            console.log(`   Found ${corrupted.length} additional corrupted facts:`);
            for (const f of corrupted) {
                console.log(`   🔥 DELETING: [${f.id.substring(0, 8)}] "${f.content.substring(0, 50)}..."`);
                await graph.runQuery(`MATCH (f:Fact {id: $id}) DETACH DELETE f`, { id: f.id });
                deletedCount++;
            }
        } else {
            console.log("   ✅ No additional patterns found.");
        }
    } catch (e: any) {
        console.log("   Error in regex scan:", e.message);
    }

    // 3. Summary
    console.log("\n" + "=".repeat(50));
    console.log(`✨ EXORCISM COMPLETE. Deleted ${deletedCount} corrupted memories.`);
    console.log("=".repeat(50));

    process.exit(0);
}

exorcise().catch(console.error);
