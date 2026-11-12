// Test safety boundary, not a service mock. Refuse a model/bootstrap module
// before it can execute. The consumers and Qdrant SDK below remain real.
import { register } from 'node:module';
import fs from 'node:fs';
const audit = process.env.QDRANT_CONSUMER_GUARD_AUDIT;
if (!audit) throw new Error('QDRANT_CONSUMER_GUARD_AUDIT required');
fs.writeFileSync(audit, 'guard_installed\n');
register(new URL('./qdrant-no-models.loader.mjs', import.meta.url), { data: { audit } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== process.env.QDRANT_CONSUMER_TEST_URL) {
        fs.appendFileSync(audit, 'blocked_non_test_fetch\n');
        throw new Error('Integration test permits only the explicit loopback Qdrant URL');
    }
    return originalFetch(input, options);
};
