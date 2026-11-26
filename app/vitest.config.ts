import { defineConfig } from 'vitest/config'

// `pnpm test` runs the unit tests (*.test.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000
  }
})
