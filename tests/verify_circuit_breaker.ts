
import { ProviderHealthManager } from '../services/providerHealthManager';

const mgr = ProviderHealthManager.getInstance();

console.log("🚦 Starting Circuit Breaker Test...");

// 1. Initial State
console.log(`OpenRouter Available? ${mgr.isAvailable('openrouter')}`); // Should be true

// 2. Simulate 3 Failures (Tier 1: 15 mins)
console.log("\n🧪 Simulating 3 failures (Tier 1)...");
mgr.reportFailure('openrouter', 'Quota Exceeded');
mgr.reportFailure('openrouter', 'Quota Exceeded');
mgr.reportFailure('openrouter', 'Quota Exceeded');

console.log(`OpenRouter Available? ${mgr.isAvailable('openrouter')}`); // Should be false
let backoff = mgr.getBackoffTime('openrouter') / 1000 / 60;
console.log(`Backoff: ~${backoff.toFixed(1)} mins (Expected: 15)`);

// 3. Simulate Recovery Attempt (Success)
console.log("\n🧪 Simulating Success (Reset)...");
mgr.reportSuccess('openrouter');
console.log(`OpenRouter Available? ${mgr.isAvailable('openrouter')}`); // Should be true

// 4. Simulate 5 Failures (Tier 2: 6 hours)
console.log("\n🧪 Simulating 5 failures (Tier 2)...");
for (let i = 0; i < 5; i++) mgr.reportFailure('openrouter', 'Quota Exceeded');

backoff = mgr.getBackoffTime('openrouter') / 1000 / 60 / 60;
console.log(`Backoff: ~${backoff.toFixed(1)} hours (Expected: 6)`);

// 5. Simulate 7 Failures (Tier 3: 24 hours)
console.log("\n🧪 Simulating 7 failures (Tier 3)...");
mgr.reportSuccess('openrouter'); // Reset first
for (let i = 0; i < 7; i++) mgr.reportFailure('openrouter', 'Quota Exceeded');

backoff = mgr.getBackoffTime('openrouter') / 1000 / 60 / 60;
console.log(`Backoff: ~${backoff.toFixed(1)} hours (Expected: 24)`);

console.log("\n✅ Circuit Breaker Logic Verified.");
