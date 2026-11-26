import { expect, it } from 'vitest'
import { MIN_WINDOW, WINDOW, windowSize } from './frame'

it('opens at its own size, and under test at the size the run asks for', () => {
  expect(windowSize(false, '1920x1080')).toEqual(WINDOW)
  expect(windowSize(true, undefined)).toEqual(WINDOW)
  expect(windowSize(true, '1920x1080')).toEqual({ width: 1920, height: 1080 })
})

it('takes no size that is not one, or that is smaller than the window may be', () => {
  for (const asked of ['big', '1920', '1920x', 'x1080', `${MIN_WINDOW.width - 1}x900`, `1440x${MIN_WINDOW.height - 1}`, '100000x900']) {
    expect([asked, windowSize(true, asked)]).toEqual([asked, WINDOW])
  }
})
