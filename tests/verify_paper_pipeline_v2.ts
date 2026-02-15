/**
 * Verification Test: Publication-Quality Paper Pipeline 2.0
 * 
 * Tests the complete rigorous paper generation flow:
 * 1. Insight synthesis
 * 2. Reference collection (20+ papers)
 * 3. Figure generation
 * 4. Paper writing with methodology
 * 5. Rigorous peer review (6 dimensions)
 * 6. Revision loop
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local first (contains API keys), then .env as fallback
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config(); // Load .env as fallback for any missing vars

async function verifyPaperPipeline() {
    console.log('\n' + '═'.repeat(60));
    console.log('🧪 PAPER PIPELINE 2.0 VERIFICATION TEST');
    console.log('═'.repeat(60) + '\n');

    const { paperPipeline } = await import('../services/paperPipeline');
    const { synthesisService } = await import('../services/synthesisService');

    // Step 1: Create insight (or use existing)
    console.log('[TEST] Step 1: Getting/creating insight...');
    let insight = await synthesisService.synthesizeFromRecent({
        minDiscoveries: 3,
        includeResearch: true
    });

    if (!insight) {
        console.error('❌ Failed to create insight');
        return;
    }
    console.log(`✅ Insight: "${insight.title}"`);
    console.log(`   Confidence: ${(insight.confidence * 100).toFixed(1)}%`);
    console.log(`   Discoveries: ${insight.discoveries.length}`);

    // Step 2: Generate rigorous paper
    console.log('\n[TEST] Step 2: Generating rigorous paper...');
    const paper = await paperPipeline.generatePublicationPaper({
        insightId: insight.id,
        minReferences: 15, // Reduced for faster testing
        generateFigures: true,
        format: 'markdown',
        maxRevisions: 1
    });

    if (!paper) {
        console.error('❌ Paper generation failed');
        return;
    }

    // Step 3: Validate paper structure
    console.log('\n[TEST] Step 3: Validating paper structure...');
    const checks = [
        { name: 'Has ID', pass: !!paper.id },
        { name: 'Has title', pass: !!paper.title },
        { name: 'Has abstract', pass: !!paper.abstract },
        { name: 'Has authors', pass: paper.authors.length > 0 },
        { name: 'Has methodology', pass: !!paper.methodology },
        { name: 'Has sections (6+)', pass: paper.sections.length >= 6 },
        { name: 'Has references (15+)', pass: paper.references.length >= 15 },
        { name: 'Has defined metrics', pass: paper.metrics.length > 0 },
        { name: 'Has peer review', pass: !!paper.peerReview },
        { name: 'Has data availability', pass: !!paper.dataAvailability },
        { name: 'Has revision history', pass: paper.revisionHistory.length > 0 }
    ];

    let passCount = 0;
    for (const check of checks) {
        console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
        if (check.pass) passCount++;
    }

    // Step 4: Display summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 PAPER SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Title: ${paper.title}`);
    console.log(`Version: ${paper.version}`);
    console.log(`Status: ${paper.status}`);
    console.log(`References: ${paper.references.length}`);
    console.log(`Figures: ${paper.figures.length}`);
    console.log(`Tables: ${paper.tables.length}`);
    console.log(`Metrics Defined: ${paper.metrics.length}`);
    console.log(`File: ${paper.filePath}`);

    if (paper.peerReview) {
        console.log('\n📝 PEER REVIEW');
        console.log(`   Overall Score: ${paper.peerReview.overallScore}/10`);
        console.log(`   Verdict: ${paper.peerReview.verdict}`);
        console.log(`   Scores:`);
        console.log(`     - Methodology: ${paper.peerReview.scores.methodology}/10`);
        console.log(`     - Evidence: ${paper.peerReview.scores.evidenceQuality}/10`);
        console.log(`     - Novelty: ${paper.peerReview.scores.novelty}/10`);
        console.log(`     - Clarity: ${paper.peerReview.scores.clarity}/10`);
        console.log(`     - Reproducibility: ${paper.peerReview.scores.reproducibility}/10`);
        console.log(`     - References: ${paper.peerReview.scores.references}/10`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`✅ VERIFICATION: ${passCount}/${checks.length} checks passed`);
    console.log('═'.repeat(60) + '\n');

    // Step 5: Show sample references
    console.log('📚 SAMPLE REFERENCES (first 5):');
    paper.references.slice(0, 5).forEach((ref, i) => {
        console.log(`   [${i + 1}] ${ref.title.slice(0, 60)}... (${ref.year})`);
    });

    console.log('\n✅ PAPER PIPELINE 2.0 TEST COMPLETE\n');
}

verifyPaperPipeline().catch(console.error);
