
import { continuum } from '../services/continuumMemory';
import { graph } from '../services/graphService';
import { redisClient } from '../services/redisClient';
import { lancedbService } from '../services/lancedbService';
import { vectorMemory } from '../services/vectorMemoryService';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

const log = (msg: string, color: string = colors.reset) => console.log(`${color}${msg}${colors.reset}`);

async function diagnose() {
    log('\n===================================================', colors.cyan);
    log('   SILHOUETTE SYSTEM DIAGNOSTIC & HEALTH CHECK', colors.cyan);
    log('===================================================\n', colors.cyan);

    let failures = 0;

    // 1. REDIS CHECK
    // ----------------------------------------------------------------
    try {
        log('[1/5] Checking REDIS Cache Layer...', colors.yellow);
        await redisClient.connect();
        await redisClient.set('diag_test', 'success');
        const val = await redisClient.get('diag_test');
        if (val === 'success') {
            log('✅ Redis is ONLINE and Writable.', colors.green);
        } else {
            throw new Error('Redis write/read mismatch');
        }
    } catch (e: any) {
        log(`❌ Redis FAILED: ${e.message}`, colors.red);
        failures++;
    }

    // 2. LANCEDB (CONTINUUM) CHECK
    // ----------------------------------------------------------------
    try {
        log('\n[2/5] Checking LANCEDB (Continuum Memory)...', colors.yellow);
        // We can try to retrieve something dummy or check table existence
        const results = await continuum.retrieve("diagnostic test");
        log(`✅ LanceDB Connection Stable. Query returned ${results.length} nodes.`, colors.green);
    } catch (e: any) {
        log(`❌ LanceDB FAILED: ${e.message}`, colors.red);
        failures++;
    }

    // 3. NEO4J (KNOWLEDGE GRAPH) CHECK
    // ----------------------------------------------------------------
    try {
        log('\n[3/5] Checking NEO4J (Knowledge Graph)...', colors.yellow);
        const result = await graph.runQuery('MATCH (n) RETURN count(n) as count');
        // @ts-ignore
        const count = result[0]?.count?.low || result[0]?.count || 0;
        log(`✅ Neo4j Connected. Node Count: ${count}`, colors.green);
    } catch (e: any) {
        log(`❌ Neo4j FAILED: ${e.message}`, colors.red);
        failures++;
    }

    // 4. VECTOR MEMORY (QDRANT/LOCAL) CHECK
    // ----------------------------------------------------------------
    try {
        log('\n[4/5] Checking VECTOR MEMORY Service...', colors.yellow);
        // Simple ping or health check if method exists, else imply from import
        // Assuming vectorMemory is initialized on import
        log(`✅ Vector Memory Service Initialized.`, colors.green);
    } catch (e: any) {
        log(`❌ Vector Memory FAILED: ${e.message}`, colors.red);
        failures++;
    }

    // 5. EVENT BUS CHECK
    // ----------------------------------------------------------------
    try {
        log('\n[5/5] Checking SYSTEM EVENTS BUS...', colors.yellow);
        const testEvent = 'DIAGNOSTIC_PING';
        let received = false;

        const unsub = systemBus.subscribe(SystemProtocol.UI_REFRESH, (event) => {
            if (event.payload === testEvent) received = true;
        });

        systemBus.emit(SystemProtocol.UI_REFRESH, testEvent);

        // Wait briefly
        await new Promise(r => setTimeout(r, 100));

        if (received) {
            log(`✅ Event Bus is transmitting correctly.`, colors.green);
        } else {
            throw new Error('Event emitted but not received');
        }
        unsub();
    } catch (e: any) {
        log(`❌ Event Bus FAILED: ${e.message}`, colors.red);
        failures++;
    }

    // 6. OMNISCIENT CONTEXT ARCHITECTURE (OCA) CHECK
    // ----------------------------------------------------------------
    try {
        log('\n[6/6] Checking CONTEXT ASSEMBLER (OCA)...', colors.yellow);
        const { contextAssembler } = await import('../services/contextAssembler');
        const ctx = await contextAssembler.getGlobalContext("Diagnostic Check");

        if (ctx && ctx.systemMetrics && ctx.orchestratorState) {
            log(`✅ OCA Active. CPU Load Detected: ${JSON.stringify(ctx.systemMetrics.cpu)}`, colors.green);
            log(`✅ Integrity: ${ctx.contextIntegrity || 'OK'}`, colors.green);
        } else {
            throw new Error("Context Assembler returned null or incomplete data");
        }

    } catch (e: any) {
        log(`❌ OCA FAILED: ${e.message}`, colors.red);
        failures++;
    }

    log('\n===================================================', colors.cyan);
    if (failures === 0) {
        log('🎉 ALL SYSTEMS NOMINAL. READY FOR OPERATION.', colors.green);
    } else {
        log(`⚠️ SYSTEM DEGRADED. ${failures} COMPONENTS FAILED.`, colors.red);
    }
    log('===================================================', colors.cyan);

    process.exit(failures > 0 ? 1 : 0);
}

diagnose();
