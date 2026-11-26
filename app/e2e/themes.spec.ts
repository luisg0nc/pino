import { expect, test } from '@playwright/test'
import { launch, type Launched } from './launch'

let run: Launched

test.beforeAll(async () => {
  run = await launch()
})
test.afterAll(async () => {
  await run?.app.close()
})

const token = (name: string): Promise<string> => run.page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase(), name)

test('the accent is solder-mask green in light and in dark', async () => {
  await run.page.emulateMedia({ colorScheme: 'light' })
  expect(await token('--accent')).toBe('#17663A')
  await run.page.emulateMedia({ colorScheme: 'dark' })
  expect(await token('--accent')).toBe('#5CC489')
})

test('the bundled faces are what the window is set in', async () => {
  const faces = await run.page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''))
  })
  expect(faces).toContain('Instrument Sans')
  expect(await run.page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Instrument Sans')
})
