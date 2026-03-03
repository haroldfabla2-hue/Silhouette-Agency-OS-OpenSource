import { IPlugin, PluginToolDefinition } from '../../pluginInterface';

/**
 * UNIFIED GOOGLE WORKSPACE PLUGIN
 * 
 * A single plugin providing access to ALL Google services:
 * Calendar, Drive, Docs, Sheets, Slides, Forms, Meet, Places, Gmail.
 * 
 * Each service can be individually enabled/disabled via config/plugins.json:
 * ```json
 * "integration-google-workspace": {
 *     "enabled": true,
 *     "services": { "calendar": true, "drive": true, "gmail": false, ... }
 * }
 * ```
 * 
 * Requires: GOOGLE_WORKSPACE_CREDENTIALS (OAuth2 JSON) or individual API keys in .env.local
 */

// ════════════════════════════════════════════════════════════════
// SERVICE TOOL GENERATORS  (each returns tools for one service)
// ════════════════════════════════════════════════════════════════

function calendarTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_calendar_list_events',
            description: 'Lists upcoming events from the user\'s Google Calendar.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    maxResults: { type: 'NUMBER', description: 'Max events to return (default 10).' },
                    timeMin: { type: 'STRING', description: 'Start time ISO (default: now).' }
                }
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const cal = google.calendar({ version: 'v3', auth });
                const res = await cal.events.list({
                    calendarId: 'primary',
                    timeMin: args.timeMin || new Date().toISOString(),
                    maxResults: args.maxResults || 10,
                    singleEvents: true, orderBy: 'startTime'
                });
                return (res.data.items || []).map((e: any) => ({
                    id: e.id, summary: e.summary,
                    start: e.start?.dateTime || e.start?.date,
                    end: e.end?.dateTime || e.end?.date,
                    location: e.location
                }));
            }
        },
        {
            name: 'google_calendar_create_event',
            description: 'Creates a new event on Google Calendar.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    summary: { type: 'STRING', description: 'Event title.' },
                    start: { type: 'STRING', description: 'Start datetime ISO.' },
                    end: { type: 'STRING', description: 'End datetime ISO.' },
                    description: { type: 'STRING', description: 'Optional description.' },
                    location: { type: 'STRING', description: 'Optional location.' }
                },
                required: ['summary', 'start', 'end']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const cal = google.calendar({ version: 'v3', auth });
                const res = await cal.events.insert({
                    calendarId: 'primary',
                    requestBody: {
                        summary: args.summary, description: args.description,
                        location: args.location,
                        start: { dateTime: args.start }, end: { dateTime: args.end }
                    }
                });
                return { eventId: res.data.id, link: res.data.htmlLink };
            }
        }
    ];
}

function driveTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_drive_list_files',
            description: 'Lists files in Google Drive.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    query: { type: 'STRING', description: 'Optional search query.' },
                    maxResults: { type: 'NUMBER', description: 'Max files (default 20).' }
                }
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const drive = google.drive({ version: 'v3', auth });
                const res = await drive.files.list({
                    q: args.query || undefined, pageSize: args.maxResults || 20,
                    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)'
                });
                return (res.data.files || []).map((f: any) => ({
                    id: f.id, name: f.name, mimeType: f.mimeType,
                    modified: f.modifiedTime, link: f.webViewLink
                }));
            }
        },
        {
            name: 'google_drive_read_file',
            description: 'Reads text content of a Google Drive document.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    fileId: { type: 'STRING', description: 'Google Drive file ID.' },
                    mimeType: { type: 'STRING', description: 'Export MIME (default text/plain).' }
                },
                required: ['fileId']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const drive = google.drive({ version: 'v3', auth });
                const res = await drive.files.export(
                    { fileId: args.fileId, mimeType: args.mimeType || 'text/plain' },
                    { responseType: 'text' }
                );
                const content = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
                return { content: content.substring(0, 15000) };
            }
        }
    ];
}

function docsTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_docs_create',
            description: 'Creates a new Google Docs document.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    title: { type: 'STRING', description: 'Document title.' },
                    body: { type: 'STRING', description: 'Initial text content.' }
                },
                required: ['title']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const docs = google.docs({ version: 'v1', auth });
                const res = await docs.documents.create({ requestBody: { title: args.title } });
                if (args.body && res.data.documentId) {
                    await docs.documents.batchUpdate({
                        documentId: res.data.documentId,
                        requestBody: {
                            requests: [{ insertText: { location: { index: 1 }, text: args.body } }]
                        }
                    });
                }
                return { documentId: res.data.documentId, title: res.data.title };
            }
        }
    ];
}

function sheetsTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_sheets_read',
            description: 'Reads data from a Google Sheets spreadsheet.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    spreadsheetId: { type: 'STRING', description: 'Spreadsheet ID.' },
                    range: { type: 'STRING', description: 'Cell range (e.g. "Sheet1!A1:D10").' }
                },
                required: ['spreadsheetId', 'range']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const sheets = google.sheets({ version: 'v4', auth });
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: args.spreadsheetId, range: args.range
                });
                return { values: res.data.values, range: res.data.range };
            }
        },
        {
            name: 'google_sheets_write',
            description: 'Writes data to a Google Sheets spreadsheet.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    spreadsheetId: { type: 'STRING', description: 'Spreadsheet ID.' },
                    range: { type: 'STRING', description: 'Target range (e.g. "Sheet1!A1").' },
                    values: { type: 'STRING', description: 'JSON array of arrays (rows). Example: [["A","B"],["C","D"]]' }
                },
                required: ['spreadsheetId', 'range', 'values']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const sheets = google.sheets({ version: 'v4', auth });
                const parsedValues = typeof args.values === 'string' ? JSON.parse(args.values) : args.values;
                const res = await sheets.spreadsheets.values.update({
                    spreadsheetId: args.spreadsheetId, range: args.range,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: parsedValues }
                });
                return { updatedCells: res.data.updatedCells, updatedRange: res.data.updatedRange };
            }
        }
    ];
}

function gmailTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_gmail_list',
            description: 'Lists recent emails from the user\'s Gmail inbox.',
            category: 'COMMUNICATION',
            parameters: {
                type: 'OBJECT',
                properties: {
                    maxResults: { type: 'NUMBER', description: 'Max emails (default 10).' },
                    query: { type: 'STRING', description: 'Gmail search query (e.g. "is:unread").' }
                }
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const gmail = google.gmail({ version: 'v1', auth });
                const list = await gmail.users.messages.list({
                    userId: 'me', maxResults: args.maxResults || 10, q: args.query || ''
                });
                const messages = [];
                for (const msg of (list.data.messages || []).slice(0, 10)) {
                    const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
                    const headers = detail.data.payload?.headers || [];
                    messages.push({
                        id: msg.id,
                        subject: headers.find((h: any) => h.name === 'Subject')?.value,
                        from: headers.find((h: any) => h.name === 'From')?.value,
                        date: headers.find((h: any) => h.name === 'Date')?.value,
                        snippet: detail.data.snippet
                    });
                }
                return messages;
            }
        },
        {
            name: 'google_gmail_send',
            description: 'Sends an email via Gmail.',
            category: 'COMMUNICATION',
            parameters: {
                type: 'OBJECT',
                properties: {
                    to: { type: 'STRING', description: 'Recipient email address.' },
                    subject: { type: 'STRING', description: 'Email subject.' },
                    body: { type: 'STRING', description: 'Email body (plain text).' }
                },
                required: ['to', 'subject', 'body']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const gmail = google.gmail({ version: 'v1', auth });
                const raw = Buffer.from(
                    `To: ${args.to}\nSubject: ${args.subject}\nContent-Type: text/plain; charset=utf-8\n\n${args.body}`
                ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
                return { messageId: res.data.id, threadId: res.data.threadId };
            }
        }
    ];
}

function placesTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_places_search',
            description: 'Searches for places/businesses using Google Places API.',
            category: 'RESEARCH',
            parameters: {
                type: 'OBJECT',
                properties: {
                    query: { type: 'STRING', description: 'Search query (e.g. "restaurants near me").' },
                    location: { type: 'STRING', description: 'Optional lat,lng (e.g. "40.7128,-74.0060").' },
                    radius: { type: 'NUMBER', description: 'Search radius in meters (default 5000).' }
                },
                required: ['query']
            } as any,
            handler: async (args: any) => {
                const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
                if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY');
                const params = new URLSearchParams({
                    query: args.query, key: apiKey,
                    ...(args.location && { location: args.location }),
                    ...(args.radius && { radius: String(args.radius) })
                });
                const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
                if (!res.ok) throw new Error(`Places API error: ${res.status}`);
                const data = await res.json();
                return (data.results || []).slice(0, 10).map((p: any) => ({
                    name: p.name, address: p.formatted_address,
                    rating: p.rating, types: p.types?.slice(0, 3),
                    location: p.geometry?.location
                }));
            }
        }
    ];
}

function meetTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_meet_create',
            description: 'Creates a Google Meet video conference link via Calendar event.',
            category: 'COMMUNICATION',
            parameters: {
                type: 'OBJECT',
                properties: {
                    summary: { type: 'STRING', description: 'Meeting title.' },
                    start: { type: 'STRING', description: 'Start datetime ISO.' },
                    duration: { type: 'NUMBER', description: 'Duration in minutes (default 60).' }
                },
                required: ['summary', 'start']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const cal = google.calendar({ version: 'v3', auth });
                const startDate = new Date(args.start);
                const endDate = new Date(startDate.getTime() + (args.duration || 60) * 60000);
                const res = await cal.events.insert({
                    calendarId: 'primary',
                    conferenceDataVersion: 1,
                    requestBody: {
                        summary: args.summary,
                        start: { dateTime: startDate.toISOString() },
                        end: { dateTime: endDate.toISOString() },
                        conferenceData: {
                            createRequest: { requestId: `silhouette-${Date.now()}` }
                        }
                    }
                });
                return {
                    eventId: res.data.id,
                    meetLink: res.data.hangoutLink || res.data.conferenceData?.entryPoints?.[0]?.uri,
                    htmlLink: res.data.htmlLink
                };
            }
        }
    ];
}

function formsTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_forms_list_responses',
            description: 'Lists responses from a Google Form.',
            category: 'UTILITY',
            parameters: {
                type: 'OBJECT',
                properties: {
                    formId: { type: 'STRING', description: 'Google Form ID.' }
                },
                required: ['formId']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const forms = google.forms({ version: 'v1', auth });
                const res = await forms.forms.responses.list({ formId: args.formId });
                return (res.data.responses || []).slice(0, 20).map((r: any) => ({
                    responseId: r.responseId,
                    createTime: r.createTime,
                    answers: r.answers
                }));
            }
        }
    ];
}

function slidesTools(): PluginToolDefinition[] {
    return [
        {
            name: 'google_slides_create',
            description: 'Creates a new Google Slides presentation.',
            category: 'MEDIA',
            parameters: {
                type: 'OBJECT',
                properties: {
                    title: { type: 'STRING', description: 'Presentation title.' }
                },
                required: ['title']
            } as any,
            handler: async (args: any) => {
                const { google } = await import('googleapis');
                const auth = await getAuth();
                const slides = google.slides({ version: 'v1', auth });
                const res = await slides.presentations.create({ requestBody: { title: args.title } });
                return {
                    presentationId: res.data.presentationId,
                    title: res.data.title,
                    slides: res.data.slides?.length || 0
                };
            }
        }
    ];
}

// ════════════════════════════════════════════════════════════════
// AUTH HELPER
// ════════════════════════════════════════════════════════════════

async function getAuth(): Promise<any> {
    const { google } = await import('googleapis');
    // Try OAuth2 credentials file first, then fall back to API key
    try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const credPath = path.join(process.cwd(), 'config', 'google_credentials.json');
        const tokenPath = path.join(process.cwd(), 'config', 'google_token.json');
        const creds = JSON.parse(await fs.readFile(credPath, 'utf-8'));
        const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
        const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);
        try {
            const token = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
            oauth2.setCredentials(token);
            return oauth2;
        } catch {
            console.warn('[GoogleWorkspace] No token file found. OAuth2 flow needed. Falling back to API key.');
        }
    } catch {
        // No credentials file, use API key
    }
    return process.env.GOOGLE_API_KEY || process.env.GOOGLE_WORKSPACE_API_KEY;
}

// ════════════════════════════════════════════════════════════════
// PLUGIN DEFINITION
// ════════════════════════════════════════════════════════════════

const SERVICE_MAP: Record<string, () => PluginToolDefinition[]> = {
    calendar: calendarTools,
    drive: driveTools,
    docs: docsTools,
    sheets: sheetsTools,
    gmail: gmailTools,
    places: placesTools,
    meet: meetTools,
    forms: formsTools,
    slides: slidesTools
};

// Dynamically load enabled services from plugins.json
let enabledTools: PluginToolDefinition[] = [];

const googleWorkspacePlugin: IPlugin = {
    id: 'integration-google-workspace',
    name: 'Google Workspace',
    version: '1.0.0',
    description: 'Unified access to Google Calendar, Drive, Docs, Sheets, Gmail, Slides, Forms, Meet, and Places.',
    author: 'Silhouette',

    get tools() {
        return enabledTools;
    },

    onInit: async () => {
        // Read per-service config from plugins.json
        let serviceConfig: Record<string, boolean> = {};
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const configPath = path.join(process.cwd(), 'config', 'plugins.json');
            const data = JSON.parse(await fs.readFile(configPath, 'utf-8'));
            serviceConfig = data.plugins?.['integration-google-workspace']?.services || {};
        } catch {
            console.warn('[GoogleWorkspace] No plugins.json config found, enabling all services.');
        }

        // Build tool list based on enabled services
        enabledTools = [];
        for (const [service, generator] of Object.entries(SERVICE_MAP)) {
            const isEnabled = serviceConfig[service] !== false; // Default: enabled
            if (isEnabled) {
                enabledTools.push(...generator());
                console.log(`[GoogleWorkspace] ✅ ${service} enabled (${generator().length} tools)`);
            } else {
                console.log(`[GoogleWorkspace] ⏸️ ${service} disabled`);
            }
        }

        console.log(`[GoogleWorkspace] Initialized with ${enabledTools.length} tools from ${Object.keys(serviceConfig).filter(k => serviceConfig[k] !== false).length || 'all'} services.`);
    }
};

export default googleWorkspacePlugin;
