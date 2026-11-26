import { defineConfig } from 'vitest/config'

// `pnpm test` runs the unit tests (*.test.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
    // Stylesheets are empty under test, but the tokens: the board's light colours are read from their text.
    css: { include: [/tokens\.css/] }
  }
})
