import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      host: '0.0.0.0',
      proxy: {
        '/v1': {
          target: process.env.VITE_API_TARGET || 'http://127.0.0.1:3005',
          changeOrigin: true,
        }
      }
    },
    plugins: [react()],
    // NOTE: API keys are intentionally NOT injected into the frontend bundle.
    // All LLM calls must go through the backend proxy at /v1/*.
    build: {
      chunkSizeWarningLimit: 1300, // Increased for vendor libs (three.js ~1.2MB)
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // 3D/Graphics - largest libraries
              if (id.includes('three') || id.includes('3d-force')) {
                return 'vendor-3d';
              }
              if (id.includes('force-graph')) {
                return 'vendor-force-graph';
              }
              // React ecosystem
              if (id.includes('react-dom') || id.includes('react-router') || id.includes('scheduler')) {
                return 'vendor-react';
              }
              // Charts/D3
              if (id.includes('recharts') || id.includes('d3-')) {
                return 'vendor-charts';
              }
              // UI libraries
              if (id.includes('framer-motion') || id.includes('lucide') || id.includes('@radix-ui')) {
                return 'vendor-ui';
              }
              // Monaco editor
              if (id.includes('monaco')) {
                return 'vendor-monaco';
              }
              // Redis (externalized for browser)
              if (id.includes('redis')) {
                return 'vendor-redis';
              }
            }
          }
        }
      }
    },
    resolve: {
      alias: [
        // Specific alias for agentPersistence to force mock in browser
        { find: '@/services/agentPersistence', replacement: path.resolve(__dirname, './mocks/agentPersistence.ts') },

        // MOCK BACKEND SERVICES - REGEX TO CATCH ALL RELATIVE/ABSOLUTE IMPORTS
        // Matches: ./continuumMemory, ../services/continuumMemory, @/services/continuumMemory, etc.
        { find: /^(.*[\\\/])?lancedbService(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/lancedbService.ts') },
        { find: /^(.*[\\\/])?continuumMemory(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/continuumMemory.ts') },
        { find: /^(.*[\\\/])?geminiService(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/geminiService.ts') },
        { find: /^(.*[\\\/])?redisClient(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/redisClient.ts') },
        { find: /^(.*[\\\/])?ollamaService(\.ts)?$/, replacement: path.resolve(__dirname, './mocks/ollamaService.ts') },

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

