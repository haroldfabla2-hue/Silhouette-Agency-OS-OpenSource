/**
 * VERIFY RESEARCH PAPER PIPELINE
 * Tests the full: Discovery → Synthesis → Paper → Peer Review pipeline
 */

// Load environment
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
    });
    console.log('[ENV] Loaded');
}

import { discoveryJournal } from '../services/discoveryJournal';
import { synthesisService } from '../services/synthesisService';
import { paperGenerator } from '../services/paperGenerator';

async function main() {
    console.log('🔬 RESEARCH PAPER PIPELINE VERIFICATION');
    console.log('═'.repeat(60));

    // 1. Check existing discoveries
    console.log('\n📊 STEP 1: Check Discovery Journal');
    console.log('─'.repeat(40));

    const stats = discoveryJournal.getStats();
    console.log(`Total discoveries: ${stats.total}`);
    console.log(`Accepted: ${stats.accepted}`);
    console.log(`Rejected: ${stats.rejected}`);
    console.log(`Pending: ${stats.pending}`);

    if (stats.accepted < 3) {
        console.log('\n⚠️ Not enough accepted discoveries for synthesis.');
        console.log('Run stress_test_discovery.ts first to generate discoveries.');
        console.log('Then re-run this test.');
        return;
    }

    // 2. Synthesize insights
    console.log('\n📊 STEP 2: Synthesize Insights');
    console.log('─'.repeat(40));

    const insight = await synthesisService.synthesizeFromRecent({
        minDiscoveries: 3,
        includeResearch: true
    });

    if (!insight) {
        console.log('❌ Failed to synthesize insights');
        return;
    }

    console.log(`✅ Insight created: "${insight.title}"`);
    console.log(`   Patterns: ${insight.patterns.length}`);
    console.log(`   Hypothesis: ${insight.novelHypothesis.substring(0, 80)}...`);
    console.log(`   Confidence: ${(insight.confidence * 100).toFixed(1)}%`);
    console.log(`   Evidence: ${insight.supportingEvidence.webSources.length} web + ${insight.supportingEvidence.academicPapers.length} academic`);

    // 3. Generate Paper
    console.log('\n📊 STEP 3: Generate Paper');
    console.log('─'.repeat(40));

    const paper = await paperGenerator.generateFromInsight(insight, {
        format: 'markdown',
        authors: [{ name: 'Silhouette AI Research Team', affiliation: 'Silhouette Agency OS' }]
    });

    console.log(`✅ Paper generated: ${paper.id}`);
    console.log(`   Title: ${paper.title}`);
    console.log(`   Sections: ${paper.sections.length}`);
    console.log(`   References: ${paper.references.length}`);
    console.log(`   Keywords: ${paper.keywords.join(', ')}`);

    // 4. Peer Review
    console.log('\n📊 STEP 4: Peer Review');
    console.log('─'.repeat(40));

    const review = await paperGenerator.peerReview(paper.id);
    console.log(`Review: ${review.approved ? '✅ APPROVED' : '⚠️ NEEDS REVISION'}`);
    console.log(`Feedback preview: ${review.feedback.substring(0, 200)}...`);

    // 5. Summary
    console.log('\n' + '═'.repeat(60));
    console.log('✅ RESEARCH PAPER PIPELINE COMPLETE');
    console.log(`   Paper saved to: output/papers/${paper.id}.md`);
}

main().catch(console.error);
