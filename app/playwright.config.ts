import { defineConfig } from '@playwright/test'

// The e2e tests launch the built Electron app (out/), always with PINO_TEST=1 so no window is ever shown
// (`e2e/launch.ts`). One worker: the tests share one GPU and display.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  // A runner's timing flakes a spec now and then: CI tries a failed spec once more, and the report says which passed
  // only on the second try. A desktop does not.
  retries: process.env.CI ? 1 : 0,
  // A runner is slower than the desktop the timings were set on: CI gets twice the test timeout and three times the
  // wait for an expectation.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: 'list',
  outputDir: './e2e/.results'
})
