import { expect, test } from '@playwright/test'
import { launch, type Launched } from './launch'

let run: Launched

test.beforeAll(async () => {
  run = await launch()
})
test.afterAll(async () => {
  await run?.app.close()
})

test('starts with its window hidden', async () => {
  expect(await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false])
})

test('keeps its profile in a temp folder, not under the person\'s config', async () => {
  expect(await run.app.evaluate(({ app }) => app.getPath('userData'))).toMatch(/\/pino-test-\d+-/)
})
