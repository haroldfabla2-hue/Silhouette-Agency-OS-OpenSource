/** Executable entry only. Import server/index for passive lifecycle APIs instead.
 * Starting is not readiness, useful-work, durable-close or release acceptance.
 * The root retains startup rejection and owns its shutdown; do not force exit.
 */
import { startProductionServer } from './index.js';

void startProductionServer().catch(() => {
    process.exitCode = 1;
    console.error('[STARTUP] Production entry rejected; lifecycle status remains unverified.');
});
