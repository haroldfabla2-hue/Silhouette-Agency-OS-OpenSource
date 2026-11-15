// Harness-only Vite startup adapter. Original config and tests remain unchanged.
import original from './vitest.config.ts';
import { mergeConfig } from 'vite';

export default mergeConfig(original, {
  server: { host: '127.0.0.1', middlewareMode: true, ws: false },
});
