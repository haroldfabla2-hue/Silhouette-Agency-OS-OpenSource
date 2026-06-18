import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    ssr: true,
    lib: {
      entry: path.resolve(__dirname, 'server/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js'
    },
    outDir: path.resolve(__dirname, 'dist/server'),
    emptyOutDir: true,
    rollupOptions: {
      // Externalize all npm packages and node built-ins
      external: (id) => {
        return !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('@/');
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
});
