/**
 * VERIFY SYNTHESIS AGENT INTEGRATION
 * Tests the Research_Synthesizer agent integration via SystemBus
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

import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';
import { discoveryJournal } from '../services/discoveryJournal';

async function main() {
    console.log('🧬 SYNTHESIS AGENT INTEGRATION TEST');
    console.log('═'.repeat(60));

    // Initialize orchestrator (which sets up the subscriptions)
    console.log('\n📊 STEP 1: Initialize Orchestrator');
    console.log('─'.repeat(40));
    await import('../services/orchestrator');
    console.log('✅ Orchestrator initialized with synthesis handlers');

    // Check discovery stats
    console.log('\n📊 STEP 2: Check Discovery Journal');
    console.log('─'.repeat(40));
    const stats = discoveryJournal.getStats();
    console.log(`Total discoveries: ${stats.total}`);
    console.log(`Accepted: ${stats.accepted}`);
    console.log(`Rejected: ${stats.rejected}`);
    console.log(`Pending: ${stats.pending}`);

    if (stats.accepted < 3) {
        console.log('\n⚠️ Not enough accepted discoveries (need 3+)');
        console.log('Run stress_test_discovery.ts first to generate discoveries.');
        return;
    }

    // Listen for synthesis completion
    console.log('\n📊 STEP 3: Trigger Synthesis via SystemBus');
    console.log('─'.repeat(40));

    let synthesisComplete = false;
    let insightResult: any = null;

    systemBus.subscribe(SystemProtocol.SYNTHESIS_COMPLETE, (event) => {
        console.log('[BUS] SYNTHESIS_COMPLETE received!');
        synthesisComplete = true;
        insightResult = event.payload;
    });

    // Emit synthesis request
    console.log('Emitting SYNTHESIS_REQUEST...');
    systemBus.emit(SystemProtocol.SYNTHESIS_REQUEST, {
        minDiscoveries: 3,
        includeResearch: true
    }, 'TEST');

    // Wait for completion (with timeout)
    const startTime = Date.now();
    while (!synthesisComplete && Date.now() - startTime < 120000) {
        await new Promise(r => setTimeout(r, 1000));
        process.stdout.write('.');
    }
    console.log('');

    if (!synthesisComplete) {
        console.log('❌ Synthesis timed out');
        return;
    }

    console.log('\n📊 STEP 4: Synthesis Result');
    console.log('─'.repeat(40));
    if (insightResult?.success && insightResult?.insight) {
        const insight = insightResult.insight;
        console.log(`✅ Insight created: "${insight.title}"`);
        console.log(`   Patterns: ${insight.patterns?.length || 0}`);
        console.log(`   Hypothesis: ${insight.novelHypothesis?.substring(0, 80)}...`);
        console.log(`   Confidence: ${(insight.confidence * 100).toFixed(1)}%`);
        console.log(`   Agent: ${insightResult.agentId}`);

        // Now test paper generation
        console.log('\n📊 STEP 5: Trigger Paper Generation');
        console.log('─'.repeat(40));

        let paperComplete = false;
        let paperResult: any = null;

        systemBus.subscribe(SystemProtocol.PAPER_GENERATION_COMPLETE, (event) => {
            console.log('[BUS] PAPER_GENERATION_COMPLETE received!');
            paperComplete = true;
            paperResult = event.payload;
        });

        systemBus.emit(SystemProtocol.PAPER_GENERATION_REQUEST, {
            insightId: insight.id,
            format: 'markdown',
            peerReview: true
        }, 'TEST');

        // Wait for paper
        const paperStart = Date.now();
        while (!paperComplete && Date.now() - paperStart < 180000) {
            await new Promise(r => setTimeout(r, 1000));
            process.stdout.write('.');
        }
        console.log('');

        if (paperComplete && paperResult?.success) {
            console.log(`✅ Paper generated: ${paperResult.paper?.title}`);
            console.log(`   Path: ${paperResult.path}`);
            console.log(`   Status: ${paperResult.paper?.status}`);
        }
    } else {
        console.log('❌ Synthesis failed:', insightResult?.error || 'Unknown error');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ SYNTHESIS AGENT INTEGRATION TEST COMPLETE');
}

main().catch(console.error);
