// =============================================================================
// CHANNELS BARREL EXPORT + AUTO-SETUP
// =============================================================================

export { channelRouter } from './channelRouter';
export type { IChannel, IncomingMessage, OutgoingMessage, ChannelStatus, MessageHandler } from './channelInterface';
export { WhatsAppChannel } from './whatsapp/whatsappChannel';
export { TelegramChannel } from './telegram/telegramChannel';
export { DiscordChannel } from './discord/discordChannel';

import { channelRouter } from './channelRouter';
import { getConfig } from '../config/configSchema';

/**
 * Initialize channels based on configuration.
 * Call this during server startup.
 */
export async function initializeChannels(): Promise<void> {
    const config = getConfig();
    let registered = 0;

    // WhatsApp
    if (config.channels.whatsapp?.enabled) {
        try {
            const { WhatsAppChannel } = await import('./whatsapp/whatsappChannel');
            const wa = new WhatsAppChannel({
                sessionPath: config.channels.whatsapp.sessionPath,
                allowFrom: config.channels.whatsapp.allowFrom,
            });
            channelRouter.register(wa);
            registered++;
        } catch (err) {
            console.error('[Channels] Failed to init WhatsApp:', err);
        }
    }

    // Telegram
    if (config.channels.telegram?.enabled && config.channels.telegram.botToken) {
        try {
            const { TelegramChannel } = await import('./telegram/telegramChannel');
            const tg = new TelegramChannel({
                botToken: config.channels.telegram.botToken,
                allowedChatIds: config.channels.telegram.allowedChatIds,
            });
            channelRouter.register(tg);
            registered++;
        } catch (err) {
            console.error('[Channels] Failed to init Telegram:', err);
        }
    }

    // Discord
    if (config.channels.discord?.enabled && config.channels.discord.botToken) {
        try {
            const { DiscordChannel } = await import('./discord/discordChannel');
            const dc = new DiscordChannel({
                botToken: config.channels.discord.botToken,
                allowedGuildIds: config.channels.discord.allowedGuildIds,
            });
            channelRouter.register(dc);
            registered++;
        } catch (err) {
            console.error('[Channels] Failed to init Discord:', err);
        }
    }

    if (registered > 0) {
        console.log(`[Channels] 📡 ${registered} channels registered, connecting...`);
        await channelRouter.connectAll();
    } else {
        console.log('[Channels] No channels configured (set tokens in .env.local or silhouette.config.json)');
    }
}
