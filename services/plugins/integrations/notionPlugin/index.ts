import { IPlugin } from '../../pluginInterface';

/**
 * Notion Plugin
 * 
 * Provides tools to interact with Notion:
 * - Search pages and databases
 * - Create new pages
 * - Append content blocks
 * 
 * Requires: NOTION_API_KEY (Internal Integration Token) in .env.local
 */
const notionPlugin: IPlugin = {
    id: 'integration-notion',
    name: 'Notion',
    version: '1.0.0',
    description: 'Search, read, and create content in Notion workspaces.',
    author: 'Silhouette',

    tools: [
        {
            name: 'notion_search',
            description: 'Search for pages and databases in the user\'s Notion workspace.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    query: { type: 'STRING', description: 'Search query text.' },
                    filter: { type: 'STRING', description: 'Optional: "page" or "database".' }
                },
                required: ['query']
            } as any,
            handler: async (args: { query: string; filter?: string }) => {
                const token = process.env.NOTION_API_KEY;
                const body: any = { query: args.query };
                if (args.filter) body.filter = { value: args.filter, property: 'object' };
                const res = await fetch('https://api.notion.com/v1/search', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    },
                    body: JSON.stringify(body)
                });
                if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
                const data = await res.json();
                return (data.results || []).slice(0, 10).map((r: any) => ({
                    id: r.id,
                    type: r.object,
                    title: r.properties?.title?.title?.[0]?.plain_text || r.properties?.Name?.title?.[0]?.plain_text || 'Untitled',
                    url: r.url
                }));
            }
        },
        {
            name: 'notion_create_page',
            description: 'Creates a new page in a Notion database or as a child of another page.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    parentId: { type: 'STRING', description: 'ID of the parent page or database.' },
                    parentType: { type: 'STRING', description: '"page_id" or "database_id".' },
                    title: { type: 'STRING', description: 'Title of the new page.' },
                    content: { type: 'STRING', description: 'Optional text content for the page body.' }
                },
                required: ['parentId', 'parentType', 'title']
            } as any,
            handler: async (args: { parentId: string; parentType: string; title: string; content?: string }) => {
                const token = process.env.NOTION_API_KEY;
                const body: any = {
                    parent: { [args.parentType]: args.parentId },
                    properties: {
                        title: { title: [{ text: { content: args.title } }] }
                    }
                };
                if (args.content) {
                    body.children = [{
                        object: 'block',
                        type: 'paragraph',
                        paragraph: { rich_text: [{ text: { content: args.content } }] }
                    }];
                }
                const res = await fetch('https://api.notion.com/v1/pages', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    },
                    body: JSON.stringify(body)
                });
                if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
                const page = await res.json();
                return { id: page.id, url: page.url };
            }
        }
    ],

    onInit: async () => {
        if (!process.env.NOTION_API_KEY) {
            console.warn('[Notion Plugin] ⚠️ Missing NOTION_API_KEY. Plugin tools will fail on use until configured.');
        }
    }
};

export default notionPlugin;
