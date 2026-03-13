import Database from 'better-sqlite3';
import { toolRegistry, DynamicTool } from './tools/toolRegistry';
import { Type } from "@google/genai";
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';
import { nervousSystem } from './connectionNervousSystem';

export interface SchemaTable {
    name: string;
    columns: Array<{ name: string; type: string; isPrimaryKey: boolean }>;
}

export interface SchemaDefinition {
    type: 'sqlite' | 'postgres' | 'mysql' | 'mongo';
    uri: string;
    tables: SchemaTable[];
}

export class DatabaseIntrospector {
    public dynamicConnections = new Map<string, { uri: string, dbType: string }>();

    /**
     * Connects to a database, extracts its schema, and generates Agent Tools
     */
    public async introspectAndAdapt(uri: string, dbType: 'sqlite' | 'postgres' | 'mysql' | 'mongo'): Promise<SchemaDefinition> {
        console.log(`[DB_INTROSPECTOR] 🔍 Introspecting ${dbType} database at ${uri}`);

        let schema: SchemaDefinition;

        try {
            switch (dbType) {
                case 'sqlite':
                    schema = await this.introspectSqlite(uri);
                    break;
                case 'postgres':
                case 'mysql':
                case 'mongo':
                    throw new Error(`${dbType} introspection requires the respective npm driver (pg, mysql2, mongodb) installed in the environment. Auto-adaptation for ${dbType} is simulated in this build.`);
                default:
                    throw new Error(`Unsupported database type: ${dbType}`);
            }

            console.log(`[DB_INTROSPECTOR] ✅ Emitting Schema Discovery for ${schema.tables.length} tables.`);

            // Generate Tools for the Agent to use
            await this.generateDynamicTools(schema);

            // Register into Nervous System for auto-healing
            nervousSystem.register({
                id: `dynamic_db_${dbType}_${Date.now()}`,
                name: `External ${dbType} DB (${uri})`,
                type: 'DATABASE',
                checkHealth: async () => {
                    // For SQLite we just check file access, others we'd ping
                    if (dbType === 'sqlite') {
                        try {
                            const testDb = new Database(uri.replace('sqlite://', ''), { readonly: true });
                            testDb.pragma('user_version');
                            testDb.close();
                            return true;
                        } catch (e) { return false; }
                    }
                    return true;
                },
                reconnect: async () => false, // Hard to reconnect automatically for external dynamics
                isRequired: false
            });

            // Notify UI & Nervous System
            systemBus.emit(SystemProtocol.UI_REFRESH, {
                source: 'DB_INTROSPECTOR',
                message: `Successfully adapted to ${dbType} database. ${schema.tables.length} tables mapped to Agent Tools.`,
                schema
            });

            return schema;

        } catch (error: any) {
            console.error(`[DB_INTROSPECTOR] ❌ Introspection failed: ${error.message}`);
            throw error;
        }
    }

    private async introspectSqlite(filePath: string): Promise<SchemaDefinition> {
        // Strip sqlite:// prefix if present
        const cleanPath = filePath.replace('sqlite://', '');
        const db = new Database(cleanPath, { readonly: true });

        // Exclude internal sqlite tables
        const tablesQuery = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`);
        const tables = tablesQuery.all() as { name: string }[];

        const schemaTables: SchemaTable[] = [];

        for (const t of tables) {
            const columnsQuery = db.prepare(`PRAGMA table_info('${t.name}');`);
            const columnsInfo = columnsQuery.all() as any[];

            schemaTables.push({
                name: t.name,
                columns: columnsInfo.map(c => ({
                    name: c.name,
                    type: c.type,
                    isPrimaryKey: c.pk === 1
                }))
            });
        }

        db.close();

        return {
            type: 'sqlite',
            uri: filePath,
            tables: schemaTables
        };
    }

    private async generateDynamicTools(schema: SchemaDefinition): Promise<void> {
        // Generate one generic SQL query tool mapped to this specific DB
        const toolName = `query_${schema.type}_db_${Date.now().toString().slice(-4)}`;

        const schemaContext = schema.tables.map(t =>
            `Table: ${t.name} (${t.columns.map(c => `${c.name} ${c.type}`).join(', ')})`
        ).join('\n');

        console.log(`[DB_INTROSPECTOR] 🔧 Registering dynamic tool: ${toolName}`);

        // Store the connection details for this particular dynamic tool
        this.dynamicConnections.set(toolName, { uri: schema.uri, dbType: schema.type });

        const tool: DynamicTool = {
            id: `tool_${toolName}`,
            name: toolName,
            description: `Custom SQL Query Tool for external ${schema.type} database. Available schema:\n${schemaContext}\nOutput is a JSON array of database rows resulting from the query.`,
            category: 'DATA' as any,
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: {
                        type: Type.STRING,
                        description: 'The raw SQL query to execute against the database. Use standard SQL syntax.'
                    }
                },
                required: ['query']
            } as any,
            handler: { type: 'BUILTIN', handlerName: 'handleDynamicDbQuery' },
            createdBy: 'SILHOUETTE',
            enabled: true,
            usageCount: 0,
            successCount: 0,
            createdAt: Date.now(),
            version: '1.0.0',
            tags: ['database', schema.type, 'dynamic']
        };

        toolRegistry.registerTool(tool);
    }

    public async executeQuery(toolName: string, query: string): Promise<any> {
        const conn = this.dynamicConnections.get(toolName);
        if (!conn) throw new Error("Connection not found for tool: " + toolName);

        if (conn.dbType === 'sqlite') {
            const db = new Database(conn.uri.replace('sqlite://', ''), { readonly: true });
            const stmt = db.prepare(query);
            let results;
            if (query.trim().toUpperCase().startsWith('SELECT')) {
                results = stmt.all();
            } else {
                throw new Error("Only SELECT queries are allowed by the auto-generated bridge due to Safe Mode.");
            }
            db.close();
            return results;
        }
        throw new Error("Query execution not implemented natively for " + conn.dbType);
    }
}

export const dbIntrospector = new DatabaseIntrospector();
