import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

/**
 * Ingestion Engine
 * Listens to external webhooks (Slack, GitHub, Gmail) via the SystemBus
 * Parses their proprietary payloads and converts them into cognitive tasks.
 */
export class IngestionEngine {
    constructor() {
        this.initialize();
    }

    private initialize() {
        systemBus.subscribe(SystemProtocol.WEBHOOK_RECEIVED, async (event: any) => {
            const { source, data } = event.payload;
            await this.processWebhook(source, data);
        });
        console.log(`[INGESTION_ENGINE] 📡 Listening for external webhooks on SystemBus...`);
    }

    private async processWebhook(source: string, data: any) {
        console.log(`[INGESTION_ENGINE] 📥 Received webhook from ${source}`);

        let context = '';
        let type = 'UNKNOWN';
        let senderName = 'External System';

        try {
            if (source === 'slack') {
                type = 'SLACK_MESSAGE';
                if (data?.event?.text) {
                    senderName = data.event.user || 'Slack User';
                    context = `Slack Message: ${data.event.text}`;
                }
            } else if (source === 'github') {
                type = 'GITHUB_EVENT';
                if (data?.action && data?.pull_request) {
                    senderName = data.pull_request.user?.login || 'GitHub User';
                    context = `GitHub PR ${data.action}: ${data.pull_request.title}`;
                } else if (data?.action && data?.issue) {
                    senderName = data.issue.user?.login || 'GitHub User';
                    context = `GitHub Issue ${data.action}: ${data.issue.title}\nBody: ${data.issue.body || ''}`;
                } else if (data?.pusher) {
                    senderName = data.pusher.name || 'GitHub User';
                    context = `GitHub Push to ${data.repository?.name}`;
                }
            } else if (source === 'gmail' || source === 'sendgrid') {
                type = 'EMAIL';
                senderName = data?.from || 'Email Sender';
                context = `Email Subject: ${data?.subject || 'No Subject'}\nSnippet: ${data?.text || data?.snippet || ''}`;
            }

            if (!context) {
                console.log(`[INGESTION_ENGINE] ⚠️ Unparseable or ignored webhook payload from ${source}.`);
                return;
            }

            console.log(`[INGESTION_ENGINE] 🧠 Classifying external signal: ${type}`);

            // Dispatch autonomous task to the Orchestrator via simulated USER_MESSAGE
            // This wakes up an agent (like core-01) to act on it autonomously
            const simulatedMessage = `EXTERNAL EVENT DETECTED: [${type}]\n\nSource: ${source}\nSender: ${senderName}\n\nDetails:\n${context}\n\nPlease analyze this event and take the appropriate action.`;

            systemBus.emit(SystemProtocol.USER_MESSAGE, {
                sessionId: `webhook_${source}_${Date.now()}`,
                message: simulatedMessage,
                channel: 'webhook',
                chatId: `webhook_${Date.now()}`,
                senderId: 'ingestion_engine',
                senderName: senderName,
                role: 'ADMIN' // Treat internal webhooks with Admin trust
            });

            console.log(`[INGESTION_ENGINE] 🚀 Dispatched autonomous task to Orchestrator.`);

        } catch (e: any) {
            console.error(`[INGESTION_ENGINE] ❌ Failed to dispatch webhook task:`, e.message);
        }
    }
}

export const ingestionEngine = new IngestionEngine();
