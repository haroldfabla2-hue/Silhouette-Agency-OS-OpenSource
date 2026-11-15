import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['tests/setup/preparation-host.ts', 'tests/setup/sqlite-per-worker.ts', 'tests/setup/fetch-teardown.ts', 'tests/setup/preparation-teardown.ts'],
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
            shuffle: false,
            setupFiles: 'list'
        }
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./', import.meta.url))
        }
    }
});
