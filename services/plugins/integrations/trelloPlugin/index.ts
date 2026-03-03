import { IPlugin } from '../../pluginInterface';

/**
 * Trello Plugin
 * 
 * Provides tools to interact with the user's Trello boards:
 * - List boards / lists / cards
 * - Create and move cards
 * 
 * Requires: TRELLO_API_KEY and TRELLO_TOKEN in .env.local
 */
const trelloPlugin: IPlugin = {
    id: 'integration-trello',
    name: 'Trello',
    version: '1.0.0',
    description: 'Manage Trello boards, lists, and cards.',
    author: 'Silhouette',

    tools: [
        {
            name: 'trello_list_boards',
            description: 'Lists all Trello boards the user has access to.',
            category: 'WORKFLOW',
            parameters: { type: 'OBJECT', properties: {} } as any,
            handler: async () => {
                const key = process.env.TRELLO_API_KEY;
                const token = process.env.TRELLO_TOKEN;
                const res = await fetch(`https://api.trello.com/1/members/me/boards?key=${key}&token=${token}`);
                if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
                const boards = await res.json();
                return boards.map((b: any) => ({ id: b.id, name: b.name, url: b.shortUrl }));
            }
        },
        {
            name: 'trello_list_cards',
            description: 'Lists all cards on a specific Trello board or list.',
            category: 'WORKFLOW',
            parameters: {
                type: 'OBJECT',
                properties: {
                    boardId: { type: 'STRING', description: 'ID of the Trello board.' },
                    listId: { type: 'STRING', description: 'Optional: ID of a specific list. If omitted, returns all cards on the board.' }
                },
                required: ['boardId']
            } as any,
            handler: async (args: { boardId: string; listId?: string }) => {
                const key = process.env.TRELLO_API_KEY;
                const token = process.env.TRELLO_TOKEN;
                const endpoint = args.listId
                    ? `https://api.trello.com/1/lists/${args.listId}/cards?key=${key}&token=${token}`
                    : `https://api.trello.com/1/boards/${args.boardId}/cards?key=${key}&token=${token}`;
                const res = await fetch(endpoint);
                if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
                const cards = await res.json();
                return cards.map((c: any) => ({ id: c.id, name: c.name, desc: c.desc?.substring(0, 100), due: c.due, url: c.shortUrl }));
            }
        },
        {
            name: 'trello_create_card',
            description: 'Creates a new card on a Trello list.',
            category: 'WORKFLOW',
            parameters: {
                type: 'OBJECT',
                properties: {
                    listId: { type: 'STRING', description: 'ID of the list to add the card to.' },
                    name: { type: 'STRING', description: 'Title of the card.' },
                    desc: { type: 'STRING', description: 'Optional description.' },
                    due: { type: 'STRING', description: 'Optional due date in ISO format.' }
                },
                required: ['listId', 'name']
            } as any,
            handler: async (args: { listId: string; name: string; desc?: string; due?: string }) => {
                const key = process.env.TRELLO_API_KEY;
                const token = process.env.TRELLO_TOKEN;
                const res = await fetch(`https://api.trello.com/1/cards?key=${key}&token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idList: args.listId, name: args.name, desc: args.desc, due: args.due })
                });
                if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
                const card = await res.json();
                return { id: card.id, url: card.shortUrl };
            }
        }
    ],

    onInit: async () => {
        if (!process.env.TRELLO_API_KEY || !process.env.TRELLO_TOKEN) {
            console.warn('[Trello Plugin] ⚠️ Missing TRELLO_API_KEY or TRELLO_TOKEN. Plugin will fail on use until configured.');
        }
    }
};

export default trelloPlugin;
