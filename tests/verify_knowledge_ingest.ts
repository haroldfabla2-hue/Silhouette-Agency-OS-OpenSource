
import { universalIndexer } from '../services/knowledge/universalIndexer';
import { lancedbService } from '../services/lancedbService';
import path from 'path';

async function verifyIngestion() {
    console.log("🔍 Verifying Knowledge Ingestion...");

    // 1. Ingest a specific known file to test
    const testFile = path.resolve(process.cwd(), 'universalprompts', 'Google', 'Gemini', 'README.md');
    // If that file doesn't exist, we'll try to scan one folder.

    // Actually, let's just pick the first file found in 'Google' folder to test.
    const googleDir = path.resolve(process.cwd(), 'universalprompts', 'Google');

    console.log(`[TEST] indexing folder: ${googleDir}`);

    // We will use the 'walkAndProcess' logically by calling indexAll on a subdir
    // But indexAll default to root. Let's modify indexAll to take an optional dir.
    // Done in implementation.

    await universalIndexer.indexAll(googleDir);

    console.log("✅ Indexing cycle complete. Checking DB...");

    // 2. Search for "Gemini"
    const embedding = await import('../services/geminiService').then(m => m.generateEmbedding("google gemini capabilities"));

    if (embedding) {
        const results = await lancedbService.searchKnowledge(embedding, 3);
        console.log("SEARCH RESULTS:", JSON.stringify(results.map(r => ({ path: r.path, score: r._distance })), null, 2));

        if (results.length > 0) {
            console.log("✅ Verification SUCCESS: Found indexed knowledge.");
        } else {
            console.error("❌ Verification FAILED: No results found.");
        }
    } else {
        console.error("❌ Verification FAILED: Could not generate query embedding.");
    }
}

verifyIngestion().catch(console.error);
