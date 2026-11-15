// =============================================================================
// OPTIONAL DEPENDENCIES AMBIENT TYPES
// Provides type safety and compile-time compatibility for lazy-loaded channels.
// =============================================================================

declare module 'discord.js' {
    export class Client {
        constructor(options: any);
        on(event: string, listener: (...args: any[]) => void): this;
        login(token: string): Promise<string>;
        destroy(): Promise<void>;
        channels: {
            fetch(id: string): Promise<any>;
        };
        user: {
            tag: string;
        } | null;
        guilds: {
            cache: {
                size: number;
            };
        };
    }
    export const GatewayIntentBits: any;
}

declare module '@whiskeysockets/baileys' {
    const makeWASocket: (config: any) => any;
    export const useMultiFileAuthState: (path: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
    export const DisconnectReason: {
        loggedOut: number;
    };
    export default makeWASocket;
}
