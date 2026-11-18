import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    maxWorkers: 2,
    testTimeout: 12000,
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx'],
  },
});
