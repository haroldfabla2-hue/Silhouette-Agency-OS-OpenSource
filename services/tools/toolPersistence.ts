/**
 * TOOL PERSISTENCE - SQLite Storage for Dynamic Tools
 * 
 * Persists dynamically created tools to SQLite database.
 * Allows tools to survive server restarts.
 * 
 * Part of the Self-Extending Tool System (Phase 1)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DynamicTool, ToolHandler, FunctionDeclarationSchema, ToolCategory } from './toolRegistry';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'tools.db');

class ToolPersistence {
    private db: Database.Database | null = null;
    private initialized: boolean = false;

    /**
     * Initialize database connection and schema
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        try {
            this.db = new Database(DB_PATH);
            this.createSchema();
            this.initialized = true;
            console.log('[ToolPersistence] ✅ Database initialized');
        } catch (error) {
            console.error('[ToolPersistence] ❌ Failed to initialize database:', error);
        }
    }

    /**
     * Create database schema
     */
    private createSchema(): void {
        if (!this.db) return;

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS dynamic_tools (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT NOT NULL,
                parameters TEXT NOT NULL,
                handler TEXT NOT NULL,
                category TEXT NOT NULL,
                created_by TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                usage_count INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                last_used INTEGER,
                created_at INTEGER NOT NULL,
                version TEXT NOT NULL,
                tags TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tools_name ON dynamic_tools(name);
            CREATE INDEX IF NOT EXISTS idx_tools_category ON dynamic_tools(category);
            CREATE INDEX IF NOT EXISTS idx_tools_enabled ON dynamic_tools(enabled);
        `);
    }

    /**
     * Save a dynamic tool to database
     */
    public async save(tool: DynamicTool): Promise<boolean> {
        await this.initialize();
        if (!this.db) return false;

        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO dynamic_tools 
                (id, name, description, parameters, handler, category, created_by, 
                 enabled, usage_count, success_count, last_used, created_at, version, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            stmt.run(
                tool.id,
                tool.name,
                tool.description,
                JSON.stringify(tool.parameters),
                JSON.stringify(tool.handler),
                tool.category,
                tool.createdBy,
                tool.enabled ? 1 : 0,
                tool.usageCount,
                tool.successCount,
                tool.lastUsed || null,
                tool.createdAt,
                tool.version,
                tool.tags ? JSON.stringify(tool.tags) : null
            );

            console.log(`[ToolPersistence] 💾 Saved tool: ${tool.name}`);
            return true;
        } catch (error) {
            console.error(`[ToolPersistence] ❌ Failed to save tool ${tool.name}:`, error);
            return false;
        }
    }

    /**
     * Load all persisted dynamic tools
     */
    public async loadAll(): Promise<DynamicTool[]> {
        await this.initialize();
        if (!this.db) return [];

        try {
            const stmt = this.db.prepare(`
                SELECT * FROM dynamic_tools WHERE created_by != 'SYSTEM'
            `);

            const rows = stmt.all() as any[];
            return rows.map(row => this.rowToTool(row));
        } catch (error) {
            console.error('[ToolPersistence] ❌ Failed to load tools:', error);
            return [];
        }
    }

    /**
     * Load a single tool by name
     */
    public async loadByName(name: string): Promise<DynamicTool | null> {
        await this.initialize();
        if (!this.db) return null;

        try {
            const stmt = this.db.prepare(`
                SELECT * FROM dynamic_tools WHERE name = ?
            `);

            const row = stmt.get(name) as any;
            return row ? this.rowToTool(row) : null;
        } catch (error) {
            console.error(`[ToolPersistence] ❌ Failed to load tool ${name}:`, error);
            return null;
        }
    }

    /**
     * Delete a tool from database
     */
    public async delete(name: string): Promise<boolean> {
        await this.initialize();
        if (!this.db) return false;

        try {
            const stmt = this.db.prepare(`
                DELETE FROM dynamic_tools WHERE name = ? AND created_by != 'SYSTEM'
            `);

            const result = stmt.run(name);
            if (result.changes > 0) {
                console.log(`[ToolPersistence] 🗑️ Deleted tool: ${name}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[ToolPersistence] ❌ Failed to delete tool ${name}:`, error);
            return false;
        }
    }

    /**
     * Update tool usage statistics
     */
    public async updateUsage(name: string, success: boolean): Promise<void> {
        await this.initialize();
        if (!this.db) return;

        try {
            const stmt = this.db.prepare(`
                UPDATE dynamic_tools 
                SET usage_count = usage_count + 1,
                    success_count = success_count + ?,
                    last_used = ?
                WHERE name = ?
            `);

            stmt.run(success ? 1 : 0, Date.now(), name);
        } catch (error) {
            console.error(`[ToolPersistence] ❌ Failed to update usage for ${name}:`, error);
        }
    }

    /**
     * Convert database row to DynamicTool
     */
    private rowToTool(row: any): DynamicTool {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            parameters: JSON.parse(row.parameters) as FunctionDeclarationSchema,
            handler: JSON.parse(row.handler) as ToolHandler,
            category: row.category as ToolCategory,
            createdBy: row.created_by as 'SYSTEM' | 'USER' | 'SILHOUETTE',
            enabled: row.enabled === 1,
            usageCount: row.usage_count,
            successCount: row.success_count,
            lastUsed: row.last_used || undefined,
            createdAt: row.created_at,
            version: row.version,
            tags: row.tags ? JSON.parse(row.tags) : undefined
        };
    }

    /**
     * Get statistics about stored tools
     */
    public async getStats(): Promise<{
        total: number;
        byCategory: Record<string, number>;
        byCreator: Record<string, number>;
        totalUsage: number;
    }> {
        await this.initialize();
        if (!this.db) {
            return { total: 0, byCategory: {}, byCreator: {}, totalUsage: 0 };
        }

        try {
            const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM dynamic_tools');
            const total = (totalStmt.get() as any).count;

            const categoryStmt = this.db.prepare(`
                SELECT category, COUNT(*) as count FROM dynamic_tools GROUP BY category
            `);
            const byCategory: Record<string, number> = {};
            for (const row of categoryStmt.all() as any[]) {
                byCategory[row.category] = row.count;
            }

            const creatorStmt = this.db.prepare(`
                SELECT created_by, COUNT(*) as count FROM dynamic_tools GROUP BY created_by
            `);
            const byCreator: Record<string, number> = {};
            for (const row of creatorStmt.all() as any[]) {
                byCreator[row.created_by] = row.count;
            }

            const usageStmt = this.db.prepare('SELECT SUM(usage_count) as total FROM dynamic_tools');
            const totalUsage = (usageStmt.get() as any).total || 0;

            return { total, byCategory, byCreator, totalUsage };
        } catch (error) {
            console.error('[ToolPersistence] ❌ Failed to get stats:', error);
            return { total: 0, byCategory: {}, byCreator: {}, totalUsage: 0 };
        }
    }

    /**
     * Close database connection
     */
    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initialized = false;
        }
    }
}

export const toolPersistence = new ToolPersistence();
