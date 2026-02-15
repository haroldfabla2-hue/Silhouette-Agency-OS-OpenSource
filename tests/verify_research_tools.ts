/**
 * VERIFY RESEARCH TOOLS
 * Tests the new web search and academic search capabilities.
 */

// Load .env.local
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim();
        }
    });
    console.log('[ENV] Loaded .env.local');
}

import { webSearch, academicSearch, conductResearch, generateCitation } from '../services/researchTools';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log('🔬 RESEARCH TOOLS VERIFICATION');
    console.log('═'.repeat(60));

    // 1. Test Web Search
    console.log('\n📊 TEST 1: Web Search');
    console.log('─'.repeat(40));

    const webResults = await webSearch('blockchain consensus mechanisms', 3);
    console.log(`Found ${webResults.length} web results:`);
    webResults.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.title}`);
        console.log(`     Source: ${r.source}`);
        console.log(`     ${r.snippet.substring(0, 100)}...`);
    });

    // Wait to avoid rate limiting
    await delay(1000);

    // 2. Test Academic Search
    console.log('\n📊 TEST 2: Academic Search');
    console.log('─'.repeat(40));

    const papers = await academicSearch('neural network deep learning', 3);
    console.log(`Found ${papers.length} academic papers:`);
    papers.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title} (${p.year})`);
        console.log(`     Authors: ${p.authors.slice(0, 2).join(', ')}${p.authors.length > 2 ? '...' : ''}`);
        console.log(`     Citations: ${p.citationCount}`);
    });

    // 3. Test Citation Generation
    if (papers.length > 0) {
        console.log('\n📊 TEST 3: Citation Generation');
        console.log('─'.repeat(40));

        const citation = generateCitation(papers[0], 'APA');
        console.log('APA Citation:');
        console.log(`  ${citation.text}`);
    }

    // Wait to avoid rate limiting
    await delay(1000);

    // 4. Test Combined Research
    console.log('\n📊 TEST 4: Conduct Research (Combined)');
    console.log('─'.repeat(40));

    const research = await conductResearch('DNA replication error correction', {
        web: true,
        academic: true,
        maxResults: 2
    });

    console.log(`Combined results: ${research.webResults.length} web + ${research.academicPapers.length} academic`);
    console.log(`Citations generated: ${research.citations.length}`);

    console.log('\n' + '═'.repeat(60));
    console.log('✅ RESEARCH TOOLS VERIFICATION COMPLETE');
}

main().catch(console.error);
