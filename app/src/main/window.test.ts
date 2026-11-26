import { describe, expect, it } from 'vitest'
import { frameOptions, MIN_WINDOW, SURFACE, TITLE_BAR_HEIGHT } from './frame'

// The window has no native frame, and on Linux the platform gives it no controls over the bar: pino draws the three
// itself. That --surface is what SURFACE says is held by `shared/contrast.test.ts`.

describe('the frame of the window', () => {
  it('has a least size', () => {
    expect(MIN_WINDOW).toEqual({ width: 1120, height: 700 })
    expect(TITLE_BAR_HEIGHT).toBe(40)
  })

  it('is hidden with no overlay, in light and in dark', () => {
    for (const dark of [false, true]) expect(frameOptions(dark)).toEqual({ titleBarStyle: 'hidden' })
  })

  it('has a ground of its own for each theme, painted before the first frame', () => {
    expect(SURFACE).toEqual({ light: '#F1EFEA', dark: '#1A1C1F' })
  })
})
