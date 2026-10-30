/** Test fixture (mechanics only): child-process driver for the durable
 *  consent ledger's cross-process atomicity proof. Not part of the product.
 *  argv: <dir> <token> <principalId> <conversationId> <mode>
 *  modes:
 *    race             - consumePermit once, print JSON result, exit
 *    reoffer          - reoffer(token) once with argv[7] as the new token,
 *                       print JSON result, exit (cross-process reoffer race)
 *    decide           - decide(token, argv[7]) once, print resulting status,
 *                       exit (cross-process decision race)
 *    consume-then-hang- consumePermit once, print JSON result, then hang
 *                       (parent kill -9s it: permit receipt must survive)
 *    hang-forever     - print READY then hang WITHOUT consuming
 *                       (parent kill -9s it: record must stay APPROVED) */
import { ConsentLedger } from '../../services/security/consentLedger';

const [dir, token, principalId, conversationId, mode] = process.argv.slice(2);
const ledger = new ConsentLedger(dir);

if (mode === 'decide') {
    // argv: <dir> <token> <principalId> <conversationId> decide <APPROVED|REJECTED>
    const after = ledger.decide(token, process.argv[7] as any, principalId, conversationId);
    console.log(JSON.stringify({ status: after?.status ?? null }));
    process.exit(0);
}
if (mode === 'reoffer') {
    // argv: <dir> <token> <principalId> <conversationId> reoffer <newToken>
    console.log(JSON.stringify(ledger.reoffer(token, { token: process.argv[7], expiresAt: Date.now() + 60_000 }, Date.now())));
    process.exit(0);
}
if (mode === 'race') {
    console.log(JSON.stringify(ledger.consumePermit(token, principalId, conversationId, Date.now())));
    process.exit(0);
}
if (mode === 'consume-then-hang') {
    console.log(JSON.stringify(ledger.consumePermit(token, principalId, conversationId, Date.now())));
    setInterval(() => {}, 1000);
} else if (mode === 'hang-forever') {
    console.log('READY');
    setInterval(() => {}, 1000);
} else {
    console.error(`unknown mode ${mode}`);
    process.exit(2);
}
