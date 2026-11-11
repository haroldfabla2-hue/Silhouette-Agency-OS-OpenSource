import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { sqliteService } from '../../services/sqliteService';
import { configLoader } from '../../server/config/configLoader';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';

const scenario = process.argv[2];
const original = fs.readFileSync('silhouette.config.json');
const job = { id: 'persisted-real-custom', name: 'real bus delivery', description: 'isolated',
    executeAt: Date.now()-1000, nextRun: Date.now()-1000, action: { type: scenario === 'goals-off' ? 'GOAL_CHECK' : 'CUSTOM', payload: { probe: 'isolated-event' } },
    enabled: true, createdBy: 'USER' };
sqliteService.setConfig('scheduled_tasks', [job]);
const { SchedulerService, schedulerService } = await import('../../services/schedulerService');
const service = new SchedulerService();
const events: unknown[] = [];
systemBus.subscribe(SystemProtocol.ACTION_INTENT, event => { events.push(event.payload); });
service.start();
if (scenario === 'stop') service.stop();
if (scenario === 'revoke') {
    await sleep(100);
    configLoader.saveConfig({ autonomy: { ...configLoader.getConfig().autonomy, enabled: false } });
}
await sleep(5500);
service.stop();schedulerService.stop();
const allowed = scenario === 'on';
assert.equal(events.length, allowed ? 1 : 0);
const stored = sqliteService.getConfig('scheduled_tasks');
assert.equal(stored[0].enabled, !allowed);
assert.equal(fs.readFileSync('silhouette.config.json').equals(original), scenario !== 'revoke');
console.log(JSON.stringify({ scenario, events: events.length, persistedEnabled: stored[0].enabled, configUnchanged: scenario !== 'revoke' }));
sqliteService.db.close();
