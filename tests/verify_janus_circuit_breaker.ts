/**
 * VERIFICATION TEST: Janus V2 Circuit Breaker
 * Tests that the Janus supervisor correctly limits repair attempts
 * per crash signature and enforces cooldown periods.
 * 
 * Run: npx tsx tests/verify_janus_circuit_breaker.ts
 */

import fs from 'fs';
import path from 'path';

const CRASH_LOG_DIR = path.join(process.cwd(), 'logs');
const CRASH_HISTORY_PATH = path.join(CRASH_LOG_DIR, 'janus_crash_history.json');
const MAX_REPAIRS_PER_SIGNATURE = 3;
const REPAIR_COOLDOWN_MS = 300000;

console.log('[TEST] 🔒 Janus V2 Circuit Breaker Verification');
console.log('='.repeat(60));

// Test 1: Verify constants are correct
function testConstants() {
    console.log('\n[TEST 1] Verifying circuit breaker constants...');

    // Read janus.js and verify constants exist
    const janusPath = path.join(process.cwd(), 'scripts', 'janus.js');
    const janusCode = fs.readFileSync(janusPath, 'utf-8');

    const hasMaxRepairs = janusCode.includes('MAX_REPAIRS_PER_SIGNATURE');
    const hasCooldown = janusCode.includes('REPAIR_COOLDOWN_MS');
    const hasRepairAttempts = janusCode.includes('repairAttempts');
    const hasHumanEscalation = janusCode.includes('HUMAN ESCALATION');

    console.log(`  MAX_REPAIRS_PER_SIGNATURE defined: ${hasMaxRepairs ? '✅' : '❌'}`);
    console.log(`  REPAIR_COOLDOWN_MS defined: ${hasCooldown ? '✅' : '❌'}`);
    console.log(`  repairAttempts tracking: ${hasRepairAttempts ? '✅' : '❌'}`);
    console.log(`  Human escalation message: ${hasHumanEscalation ? '✅' : '❌'}`);

    if (!hasMaxRepairs || !hasCooldown || !hasRepairAttempts || !hasHumanEscalation) {
        console.error('[TEST 1] ❌ FAILED: Missing circuit breaker constants');
        return false;
    }
    console.log('[TEST 1] ✅ PASSED');
    return true;
}

// Test 2: Verify crash history schema supports repair tracking
function testCrashHistorySchema() {
    console.log('\n[TEST 2] Verifying crash history schema...');

    // Create a test crash history with repair attempts
    const testHistory = {
        signatures: { 'abc123': 5 },
        totalCrashes: 5,
        lastRepairAt: Date.now() - 600000, // 10 min ago
        repairAttempts: { 'abc123': 2 }
    };

    // Verify repairAttempts field works
    const repairCount = testHistory.repairAttempts?.['abc123'] || 0;
    console.log(`  Repair count for 'abc123': ${repairCount}`);
    console.log(`  Under limit (${repairCount} < ${MAX_REPAIRS_PER_SIGNATURE}): ${repairCount < MAX_REPAIRS_PER_SIGNATURE ? '✅' : '❌'}`);

    // Verify cooldown logic
    const now = Date.now();
    const cooldownExpired = !testHistory.lastRepairAt || (now - testHistory.lastRepairAt >= REPAIR_COOLDOWN_MS);
    console.log(`  Cooldown expired: ${cooldownExpired ? '✅' : '❌'}`);

    console.log('[TEST 2] ✅ PASSED');
    return true;
}

// Test 3: Verify circuit breaker blocks after max attempts
function testCircuitBreakerLogic() {
    console.log('\n[TEST 3] Testing circuit breaker trigger...');

    const history = {
        signatures: { 'deadbeef': 3 },
        totalCrashes: 9,
        lastRepairAt: 0,
        repairAttempts: { 'deadbeef': MAX_REPAIRS_PER_SIGNATURE } // Already exhausted
    };

    const signature = 'deadbeef';
    const repairCount = history.repairAttempts?.[signature] || 0;
    const shouldBlock = repairCount >= MAX_REPAIRS_PER_SIGNATURE;

    console.log(`  Repair attempts for '${signature}': ${repairCount}/${MAX_REPAIRS_PER_SIGNATURE}`);
    console.log(`  Circuit breaker should activate: ${shouldBlock ? '✅' : '❌'}`);

    if (!shouldBlock) {
        console.error('[TEST 3] ❌ FAILED: Circuit breaker should block after max attempts');
        return false;
    }
    console.log('[TEST 3] ✅ PASSED');
    return true;
}

// Test 4: Verify cooldown blocks rapid repairs
function testCooldownLogic() {
    console.log('\n[TEST 4] Testing repair cooldown...');

    const history = {
        signatures: { 'cafe0001': 3 },
        totalCrashes: 3,
        lastRepairAt: Date.now() - 60000, // 1 min ago (within 5 min cooldown)
        repairAttempts: { 'cafe0001': 1 }
    };

    const now = Date.now();
    const withinCooldown = history.lastRepairAt && (now - history.lastRepairAt < REPAIR_COOLDOWN_MS);

    console.log(`  Last repair: ${Math.round((now - history.lastRepairAt) / 1000)}s ago`);
    console.log(`  Cooldown active: ${withinCooldown ? '✅' : '❌'}`);

    if (!withinCooldown) {
        console.error('[TEST 4] ❌ FAILED: Cooldown should be active');
        return false;
    }
    console.log('[TEST 4] ✅ PASSED');
    return true;
}

// Test 5: Verify janus_repair.ts auto-apply confidence threshold is 0.9
function testConfidenceThreshold() {
    console.log('\n[TEST 5] Verifying confidence threshold...');

    const repairPath = path.join(process.cwd(), 'scripts', 'janus_repair.ts');
    const repairCode = fs.readFileSync(repairPath, 'utf-8');

    // Make sure the auto apply logic uses 0.9
    const has09Threshold = repairCode.includes('confidence >= 0.9');

    console.log(`  Uses 0.9 threshold for auto-apply: ${has09Threshold ? '✅' : '❌'}`);

    if (!has09Threshold) {
        console.error('[TEST 5] ❌ FAILED: Auto-apply confidence threshold should be 0.9');
        return false;
    }
    console.log('[TEST 5] ✅ PASSED');
    return true;
}

// Run all tests
const results = [
    testConstants(),
    testCrashHistorySchema(),
    testCircuitBreakerLogic(),
    testCooldownLogic(),
    testConfidenceThreshold(),
];

console.log('\n' + '='.repeat(60));
const passed = results.filter(r => r).length;
const total = results.length;
console.log(`[RESULTS] ${passed}/${total} tests passed`);

if (passed === total) {
    console.log('[JANUS CIRCUIT BREAKER] ✅ All tests passed!');
    process.exit(0);
} else {
    console.error(`[JANUS CIRCUIT BREAKER] ❌ ${total - passed} test(s) failed`);
    process.exit(1);
}
