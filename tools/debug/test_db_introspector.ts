import path from 'path';
import { dbIntrospector } from '../../services/dbIntrospector';
import { toolRegistry } from '../../services/tools/toolRegistry';

async function testIntrospection() {
    console.log('[TEST] 🤖 Starting Universal DB Introspector test...');

    // Resolve the internal silhouette SQLite DB for a realistic test
    const targetDbPath = path.resolve(process.cwd(), 'db', 'silhouette.sqlite');

    console.log(`[TEST] 🎯 Target URI: sqlite://${targetDbPath}`);

    try {
        // Run Introspection
        const schema = await dbIntrospector.introspectAndAdapt(`sqlite://${targetDbPath}`, 'sqlite');

        console.log('\n[TEST] 📊 Introspection Results:');
        console.log(`- Type: ${schema.type}`);
        console.log(`- Tables Found: ${schema.tables.length}`);

        schema.tables.forEach(t => {
            console.log(`   * ${t.name} (${t.columns.length} columns)`);
            if (t.name === 'agents' || t.name === 'system_logs') { // Print sample structure
                console.log(`     -> Columns: ${t.columns.map(c => c.name).join(', ')}`);
            }
        });

        // Verify Dynamic Tools were generated
        console.log('\n[TEST] 🛠️ Verifying Dynamic Tools Registry:');
        const tools = toolRegistry.getAllTools();
        const generatedTool = tools.find(t => t.name.startsWith('query_sqlite_db_'));

        if (generatedTool) {
            console.log(`✅ SUCCESS! Found auto-generated tool: ${generatedTool.name}`);
            console.log(`📝 Description: ${generatedTool.description.substring(0, 100)}...`);

            // Execute the Tool natively through the handler
            console.log(`\n[TEST] ⚡ Executing auto-generated tool to read from 'agents' table...`);
            const query = "SELECT id, name, status FROM agents LIMIT 2";

            if (generatedTool.handler.type === 'BUILTIN') {
                const result = await dbIntrospector.executeQuery(generatedTool.name, query);
                console.log(`✅ Query returned ${result.length} rows.`);
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.error(`❌ Unexpected tool handler type: ${generatedTool.handler.type}`);
            }
        } else {
            console.error(`❌ FAILURE! Dynamic tool was not registered.`);
        }

    } catch (e: any) {
        console.error('\n[TEST] ❌ Test failed:', e.message);
    }
}

testIntrospection();
