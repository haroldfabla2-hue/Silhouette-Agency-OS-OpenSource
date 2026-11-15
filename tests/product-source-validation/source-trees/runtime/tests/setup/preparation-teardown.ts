/** Registered after legacy fetch teardown. Locked Vitest default hooks=stack:
 * original test hooks finish, then original hosts drain, then fetch pool closes.
 * This preserves relative order of all original hooks; no global hook override.
 */
import { afterAll } from 'vitest';
import { sealAndDrainTestFileGenerations } from './preparation-generation';
afterAll(sealAndDrainTestFileGenerations);
