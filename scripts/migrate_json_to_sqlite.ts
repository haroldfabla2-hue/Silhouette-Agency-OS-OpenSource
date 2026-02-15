
import fs from 'fs';
import path from 'path';
import { sqliteService } from '../services/sqliteService';

// Paths to Legacy JSON files
const MEMORY_FILE = path.resolve(process.cwd(), 'silhouette_memory_db.json');
const CHAT_HISTORY_FILE = path.resolve(process.cwd(), 'silhouette_chat_history.json');
const UI_STATE_FILE = path.resolve(process.cwd(), 'ui_state.json');
const COST_METRICS_FILE = path.resolve(process.cwd(), 'cost_metrics.json');

async function migrate() {
    console.log("🚀 Starting Migration: JSON -> SQLite");

    // 1. MIGRATE SYSTEM CONFIG (Memory DB)
    if (fs.existsSync(MEMORY_FILE)) {
        try {
            console.log(`[MIGRATING] ${MEMORY_FILE}...`);
            const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));

            // Allow storing the entire object as 'global_config' or individual keys?
            // Strategy: Store individual top-level keys for better granularity
            for (const [key, value] of Object.entries(data)) {
                sqliteService.setConfig(key, value);
            }
            console.log(`✅ System Config Migrated (${Object.keys(data).length} keys).`);
        } catch (e) {
            console.error(`❌ Failed to migrate Memory DB:`, e);
        }
    } else {
        console.log(`ℹ️ No Memory DB found (${MEMORY_FILE}), skipping.`);
    }

    // 2. MIGRATE CHAT HISTORY
    if (fs.existsSync(CHAT_HISTORY_FILE)) {
        try {
            console.log(`[MIGRATING] ${CHAT_HISTORY_FILE}...`);
            const messages = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf-8'));
            if (Array.isArray(messages)) {
                for (const msg of messages) {
                    sqliteService.appendChatMessage(msg);
                }
                console.log(`✅ Chat History Migrated (${messages.length} messages).`);
            } else {
                console.warn("⚠️ Chat history is not an array, skipping.");
            }
        } catch (e) {
            console.error(`❌ Failed to migrate Chat History:`, e);
        }
    } else {
        console.log(`ℹ️ No Chat History found, skipping.`);
    }

    // 3. MIGRATE UI STATE
    if (fs.existsSync(UI_STATE_FILE)) {
        try {
            console.log(`[MIGRATING] ${UI_STATE_FILE}...`);
            const uiState = JSON.parse(fs.readFileSync(UI_STATE_FILE, 'utf-8'));
            // Save as a single component state for 'global_ui' for now, or split if structured
            sqliteService.saveUiState('global_ui', uiState);
            console.log(`✅ UI State Migrated.`);
        } catch (e) {
            console.error(`❌ Failed to migrate UI State:`, e);
        }
    } else {
        console.log(`ℹ️ No UI State found, skipping.`);
    }

    // 4. MIGRATE COST METRICS
    if (fs.existsSync(COST_METRICS_FILE)) {
        try {
            console.log(`[MIGRATING] ${COST_METRICS_FILE}...`);
            const metrics = JSON.parse(fs.readFileSync(COST_METRICS_FILE, 'utf-8'));
            sqliteService.saveCostMetrics(metrics);
            console.log(`✅ Cost Metrics Migrated.`);
        } catch (e) {
            console.error(`❌ Failed to migrate Cost Metrics:`, e);
        }
    } else {
        console.log(`ℹ️ No Cost Metrics found, skipping.`);
    }

    console.log("---------------------------------------------------");
    console.log("🎉 Migration Complete. Safe to verify content in db/silhouette.sqlite");
}

migrate();
