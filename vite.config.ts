import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || process.env.VITE_ALLOWED_HOSTS || 'silhouette.albertofarah.com')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    server: {
      host: '0.0.0.0',
      allowedHosts,
      proxy: {
        '/v1': {
          target: env.VITE_API_TARGET || process.env.VITE_API_TARGET || 'http://127.0.0.1:3005',
          changeOrigin: true,
        }
      }
    },
    plugins: [react()],
    // NOTE: API keys are intentionally NOT injected into the frontend bundle.
    // All LLM calls must go through the backend proxy at /v1/*.
    build: {
      chunkSizeWarningLimit: 1300, // Large vendor bundles are acceptable; runtime stability matters more here.
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        // Specific alias for agentPersistence to force mock in browser
        { find: '@/services/agentPersistence', replacement: path.resolve(__dirname, './mocks/agentPersistence.ts') },

        // MOCK BACKEND SERVICES - REGEX TO CATCH ALL RELATIVE/ABSOLUTE IMPORTS
        // Matches: ./continuumMemory, ../services/continuumMemory, @/services/continuumMemory, etc.
        { find: /^(.*[\/])?lancedbService(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/lancedbService.ts') },
        { find: /^(.*[\/])?continuumMemory(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/continuumMemory.ts') },
        { find: /^(.*[\/])?geminiService(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/geminiService.ts') },
        { find: /^(.*[\/])?redisClient(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/redisClient.ts') },
        { find: /^(.*[\/])?ollamaService(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/ollamaService.ts') },

        // MOCK HEAVY NODE PACKAGES
        { find: 'redis', replacement: path.resolve(__dirname, './mocks/redis.ts') },
        { find: 'ioredis', replacement: path.resolve(__dirname, './mocks/ioredis.ts') },
        { find: '@lancedb/lancedb', replacement: path.resolve(__dirname, './mocks/lancedb.ts') },

        { find: '@', replacement: path.resolve(__dirname, '.') },
        { find: 'fs', replacement: path.resolve(__dirname, './mocks/fs.ts') },
        // Use 'path' package (from dependencies) instead of missing 'path-browserify'
        { find: 'path', replacement: 'path' },
        { find: 'systeminformation', replacement: path.resolve(__dirname, './mocks/systeminformation.ts') }
      ]
    }
  };
});
