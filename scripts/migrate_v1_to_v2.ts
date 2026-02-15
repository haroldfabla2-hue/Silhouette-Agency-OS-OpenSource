import * as fs from 'fs';
import * as path from 'path';
import { sqliteService } from '../services/sqliteService';
import { lancedbService } from '../services/lancedbService';
import { Agent, MemoryNode } from '../types';

const OLD_AGENTS_DIR = path.resolve(process.cwd(), 'db', 'agents');
const OLD_MEMORY_FILE = path.resolve(process.cwd(), 'silhouette_memory_db.json');

async function migrateAgents() {
    console.log("--- MIGRATING AGENTS ---");
    if (!fs.existsSync(OLD_AGENTS_DIR)) {
        console.log("No old agents directory found. Skipping.");
        return;
    }

    const files = fs.readdirSync(OLD_AGENTS_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} agent files.`);

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(OLD_AGENTS_DIR, file), 'utf-8');
            const agent = JSON.parse(raw) as Agent;
            sqliteService.upsertAgent(agent);
            process.stdout.write('.');
        } catch (e) {
            console.error(`\nFailed to migrate ${file}:`, e);
        }
    }
    console.log("\nAgents migration complete.");
}

async function migrateMemory() {
    console.log("\n--- MIGRATING MEMORY ---");
    if (!fs.existsSync(OLD_MEMORY_FILE)) {
        console.log("No old memory file found. Skipping.");
        return;
    }

    try {
        const raw = fs.readFileSync(OLD_MEMORY_FILE, 'utf-8');
        const data = JSON.parse(raw);

        // Collect all nodes from all tiers
        // Collect all nodes from all tiers (Case insensitive check)
        const nodes: MemoryNode[] = [
            ...(data.MEDIUM || data.medium || []),
            ...(data.LONG || data.long || []),
            ...(data.DEEP || data.deep || [])
        ];

        console.log(`Found ${nodes.length} memory nodes to migrate.`);

        for (const node of nodes) {
            await lancedbService.store(node);
            process.stdout.write('.');
        }
        console.log("\nMemory migration complete.");

    } catch (e) {
        console.error("\nFailed to migrate memory:", e);
    }
}

async function run() {
    console.log("STARTING MIGRATION V1 -> V2");
    await migrateAgents();
    await migrateMemory();
    console.log("MIGRATION FINISHED.");
    process.exit(0);
}

run();
