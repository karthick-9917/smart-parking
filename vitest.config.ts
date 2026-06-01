import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(process.cwd(), '.') },
  },
  test: {
    environment: 'node',
    globalSetup: './tests/globalSetup.ts',
    setupFiles: ['./tests/setup.ts'],
    include: ['**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    testTimeout: 30_000,
    // Enforce serial execution so concurrent-booking tests are deterministic
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/smartpark_test',
      JWT_SECRET: 'test-jwt-secret-key-32-chars-min!!',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    },
  },
})
