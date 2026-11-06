/** Test fixture (mechanics only): child-process verifier for the ingress
 *  replay store's cross-process atomicity proof. Not part of the product.
 *  argv: <keyHex> <replayDir> <payloadJsonFile>
 *  The JSON file holds { envelope, actual } as produced by a parent-run
 *  IngressAuthority.issue. Prints the verdict as JSON, then exits. */
import { readFileSync } from 'node:fs';
import { IngressAuthority } from '../../services/security/ingressEnvelope';

const [keyHex, replayDir, payloadFile] = process.argv.slice(2);
const { envelope, actual } = JSON.parse(readFileSync(payloadFile, 'utf8'));
const authority = new IngressAuthority({ key: Buffer.from(keyHex, 'hex'), replayDir });
console.log(JSON.stringify(authority.verify(envelope, actual)));
process.exit(0);
