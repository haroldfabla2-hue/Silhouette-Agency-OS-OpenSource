/** Real loopback HTTP and real cron module. Tick manually invoked, not a timer test. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { configLoader } from '../../server/config/configLoader';
import { CronScheduler } from '../../services/scheduler/cronScheduler';
let requests = 0;
const server = http.createServer((_req, res) => { requests++; res.end('actual-local-response'); });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as any).port;
const scheduler = new CronScheduler();
scheduler.addWebhookJob({ name: 'actual isolated HTTP', cronExpression: '* * * * *',
    webhookUrl: `http://127.0.0.1:${port}`, method: 'POST', enabled: true });
async function tick() { await (scheduler as any).tick(); await sleep(100); }
configLoader.saveConfig({ autonomy: { ...configLoader.getConfig().autonomy, enabled: false } });
scheduler.initialize();await tick();assert.equal(requests, 0);
configLoader.saveConfig({ autonomy: { ...configLoader.getConfig().autonomy, enabled: true } });
scheduler.initialize();await tick();assert.equal(requests, 1);
assert.equal(scheduler.listWebhookJobs()[0].fireCount, 1);
configLoader.saveConfig({ scheduler: { ...configLoader.getConfig().scheduler, enabled: false } });
await tick();assert.equal(requests, 1);assert.equal(scheduler.listWebhookJobs()[0].enabled, true);
assert.equal(scheduler.listWebhookJobs()[0].fireCount, 1);
scheduler.shutdown();await new Promise<void>(resolve => server.close(() => resolve()));
console.log(JSON.stringify({ realCronChecks: ['autonomy-off','enabled-actual-loopback-http','scheduler-disabled-after-start'], requests, pendingJobPreserved: true, timerTest: false }));
