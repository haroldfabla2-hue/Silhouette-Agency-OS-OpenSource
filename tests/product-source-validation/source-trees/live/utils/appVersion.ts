// Single source of truth for the UI version label. Injected at build time by
// vite.config.ts from package.json ("define"), so every screen shows the same value.
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
    typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';
