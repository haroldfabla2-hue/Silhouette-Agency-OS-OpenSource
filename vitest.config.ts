import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/automated/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        testTimeout: 30000,
        hookTimeout: 10000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            reportsDirectory: './coverage',
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                'tests/**',
                'scripts/**'
            ]
        },
        // Retry failed tests once (handles flaky network tests)
        retry: 1,
        // Run tests sequentially for service tests (avoid port conflicts)
        sequence: {
            shuffle: false
        }
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './')
        }
    }
});
