/** Real service/filesystem command endpoint. Test IPC is not a model or storage double.
 * Disposable authored cwd only. No forced process.exit; parent checks natural exit.
 */
import '../setup/require-cloud-only';
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import readline from 'node:readline';
import {ContinuousMemoryService} from '../../services/memory/continuousMemory';
import {agentFileSystem} from '../../services/agents/agentFileSystem';
const service = new ContinuousMemoryService();
let firstFailure: unknown;
let hasFailure = false;
const wal = () => JSON.parse(fs.readFileSync('data/wal/memory_wal.json', 'utf8'));
const send = (data: object) => console.log('OWNER_IPC ' + JSON.stringify(data));
const input = readline.createInterface({input: process.stdin});
for await (const line of input) {
    const command = JSON.parse(line);
    try {
        let result: unknown;
        switch (command.op) {
            case 'init': service.initialize(); result = {initialized: true}; break;
            case 'add': {
                const id = service.logBeforeProcessing('wal-fixture', 'MESSAGE_RECEIVED', {input: command.input});
                const record = wal().find((item: {id: string}) => item.id === id);
                assert.equal(record.status, 'PENDING');
                result = record; break;
            }
            case 'commit': service.commitEntry(command.id, command.output); result = wal(); break;
            case 'records': result = wal(); break;
            case 'same-failure': {
                assert.ok(hasFailure);
                let caught = false;
                try { service.logBeforeProcessing('wal-fixture', 'TASK_STARTED', {input: 'must not be admitted'}); }
                catch (error) { caught = true; assert.ok(Object.is(firstFailure, error), 'preserve same original storage error object'); }
                assert.ok(caught); result = {sameOriginalError: true}; break;
            }
            case 'competing-object': {
                const before = fs.readFileSync('data/wal/memory_wal.json');
                const second = new ContinuousMemoryService();
                let original: unknown;
                try { second.initialize(); } catch (error) { original = error; }
                assert.ok(original);
                assert.equal((original as {code?: string}).code, 'SQLITE_BUSY');
                assert.throws(() => second.logBeforeProcessing('wal-fixture', 'TASK_STARTED', {input: 'forbidden'}), error => Object.is(error, original));
                assert.deepEqual(fs.readFileSync('data/wal/memory_wal.json'), before);
                // No hidden store substitution, shared array or PID cleanup.
                result = {sameStoreSecondObjectRefused: true}; break;
            }
            case 'cost': {
                const samples: {appendNs: string; logNs: string; commitNs: string}[] = [];
                for (let i = 0; i < 24; i++) {
                    let start = process.hrtime.bigint();
                    agentFileSystem.appendMemory('cost-fixture', `Authored local durability sample ${i}`);
                    const appendNs = (process.hrtime.bigint() - start).toString();
                    start = process.hrtime.bigint();
                    const id = service.logBeforeProcessing('cost-fixture', 'MESSAGE_RECEIVED', {input: `local-${i}`});
                    const logNs = (process.hrtime.bigint() - start).toString();
                    start = process.hrtime.bigint(); service.commitEntry(id, 'Authored caller completion, not model output');
                    samples.push({appendNs, logNs, commitNs: (process.hrtime.bigint() - start).toString()});
                }
                result = {samples, platform: process.platform, runtime: process.version, verdict: 'MEASUREMENTS_ONLY_NO_ACCEPTABILITY_CLAIM'}; break;
            }
            case 'close':
                service.shutdown();
                send({serial: command.serial, ok: true, result: {closed: true}});
                input.close(); process.stdin.destroy();
                break;
            default: throw new Error('Unknown authored test command');
        }
        if (command.op === 'close') break;
        send({serial: command.serial, ok: true, result});
    } catch (error) {
        if (!hasFailure) {firstFailure = error; hasFailure = true;}
        send({serial: command.serial, ok: false, error: {name: error instanceof Error ? error.name : 'NonError', message: error instanceof Error ? error.message : String(error), code: (error as {code?: string})?.code}});
        // Original storage errors stay in service. A failed close still closes
        // IPC so parent can observe natural termination or an actual leak.
        if (command.op === 'close') {input.close(); process.stdin.destroy(); break;}
    }
}
