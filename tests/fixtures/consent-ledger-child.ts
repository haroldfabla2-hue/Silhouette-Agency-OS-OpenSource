/** Test fixture (mechanics only): child-process driver for the durable
 *  consent ledger's cross-process atomicity proof. Not part of the product.
 *  argv: <dir> <token> <principalId> <conversationId> <mode>
 *  modes:
 *    race             - consumePermit once, print JSON result, exit
 *    consume-then-hang- consumePermit once, print JSON result, then hang
 *                       (parent kill -9s it: permit receipt must survive)
 *    hang-forever     - print READY then hang WITHOUT consuming
 *                       (parent kill -9s it: record must stay APPROVED) */
import { ConsentLedger } from '../../services/security/consentLedger';

const [dir, token, principalId, conversationId, mode] = process.argv.slice(2);
const ledger = new ConsentLedger(dir);

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
