/**
 * Verify Media API Endpoints
 * Tests all newly created /v1/media/* endpoints
 */

import { DEFAULT_API_CONFIG } from '../constants';

const BASE_URL = `http://localhost:${DEFAULT_API_CONFIG.port}`;

async function testEndpoint(name: string, method: string, endpoint: string, body?: any): Promise<boolean> {
    try {
        const options: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}`
            }
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const res = await fetch(`${BASE_URL}${endpoint}`, options);
        const data = await res.json();

        if (res.ok) {
            console.log(`   ✅ ${name}: OK`);
            if (data.count !== undefined) console.log(`      Count: ${data.count}`);
            if (data.status) console.log(`      Status: ${data.status}`);
            return true;
        } else {
            console.log(`   ❌ ${name}: ${res.status} - ${data.error || res.statusText}`);
            return false;
        }
    } catch (e: any) {
        console.log(`   ❌ ${name}: Connection failed - ${e.message}`);
        return false;
    }
}

async function verifyMediaEndpoints() {
    console.log('🧪 Verifying Media API Endpoints\n');
    console.log('='.repeat(60));
    console.log(`Target: ${BASE_URL}/v1/media/*\n`);

    let passed = 0;
    let failed = 0;

    // Test 1: GET /v1/media/queue
    console.log('[1/8] Video Queue...');
    if (await testEndpoint('GET queue', 'GET', '/v1/media/queue')) passed++; else failed++;

    // Test 2: GET /v1/media/assets
    console.log('\n[2/8] Local Assets...');
    if (await testEndpoint('GET assets', 'GET', '/v1/media/assets')) passed++; else failed++;

    // Test 3: GET /v1/media/vram-status
    console.log('\n[3/8] VRAM Status...');
    if (await testEndpoint('GET vram-status', 'GET', '/v1/media/vram-status')) passed++; else failed++;

    // Test 4: GET /v1/media/engines
    console.log('\n[4/8] Available Engines...');
    if (await testEndpoint('GET engines', 'GET', '/v1/media/engines')) passed++; else failed++;

    // Test 5: GET /v1/media/brand/demo
    console.log('\n[5/8] Brand DNA...');
    if (await testEndpoint('GET brand', 'GET', '/v1/media/brand/demo')) passed++; else failed++;

    // Test 6: GET /v1/media/search (Unsplash)
    console.log('\n[6/8] Stock Search...');
    if (await testEndpoint('GET search', 'GET', '/v1/media/search?query=sunset')) passed++; else failed++;

    // Test 7: POST /v1/media/queue (Queue Video)
    console.log('\n[7/8] Queue Video...');
    if (await testEndpoint('POST queue', 'POST', '/v1/media/queue', {
        prompt: 'Test video from verification script',
        engine: 'WAN'
    })) passed++; else failed++;

    // Test 8: POST /v1/media/generate/image
    console.log('\n[8/8] Generate Image...');
    if (await testEndpoint('POST generate/image', 'POST', '/v1/media/generate/image', {
        prompt: 'A futuristic city at night, cyberpunk style'
    })) passed++; else failed++;

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);

    if (failed === 0) {
        console.log('✅ All Media API endpoints operational!');
    } else if (passed > 0) {
        console.log('⚠️ Some endpoints failed. Check server logs for details.');
    } else {
        console.log('❌ All endpoints failed. Is the server running?');
        console.log('   Run: npm run dev');
    }
}

// Run
verifyMediaEndpoints().catch(console.error);
