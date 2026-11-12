// Actual router and services, disposable filesystem and private network only.
// An absent dependency is a real negative result, not an emulated Qdrant.
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { healthRouter } from '../../server/routes/health';
import { vectorMemory } from '../../services/vectorMemoryService';
import { unifiedDaemon } from '../../services/daemon/unifiedDaemon';
const app = express();app.use('/health', healthRouter);
const server = app.listen('/tmp/result/health.sock');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
    const result = await new Promise<{code?: number; body: any}>((resolve, reject) => {
        http.get({socketPath:'/tmp/result/health.sock',path:'/health'}, res => {
            let text='';res.on('data', b => {text+=b;});res.on('end', () => resolve({code:res.statusCode,body:JSON.parse(text)}));
        }).on('error', reject);
    });
    assert.equal(result.code, 503);
    assert.equal(result.body.status, 'degraded');
    assert.equal(result.body.services.qdrant.status, 'down');
    assert.equal(result.body.services.daemon.status, 'down');
    assert.match(result.body.services.daemon.note, /not proof of cognitive output/);
    const status = await vectorMemory.getHealth();
    assert.equal(status.status, 'down');
    assert.equal(status.backend, 'qdrant');
    assert.equal(vectorMemory.isReady(), false, 'health must not connect/create a collection');
    assert.equal(unifiedDaemon.getRuntimeStatus().running, false);
    console.log(JSON.stringify({mode:'actual-health-router', http:result.code, unavailable_vector_not_healthy:true,
        stopped_scheduler_not_healthy:true, collection_creation_attempted:false, positive_qdrant_not_proven:true}));
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
process.exit(0);
