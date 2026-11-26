import type { BrowserWindowConstructorOptions } from 'electron'

// The window's own background, painted before the renderer's first frame.
// Keep equal to --surface in src/renderer/styles/tokens.css (shared/contrast.test.ts holds them to it).
export const SURFACE = { light: '#F1EFEA', dark: '#1A1C1F' }

/** The least the window may be: the card and the dock leave the view room (`styles/layout.css`). */
export const MIN_WINDOW = { width: 1120, height: 700 }

/** The height of the title bar, which is also the height of the platform's controls. */
export const TITLE_BAR_HEIGHT = 40

/**
 * The window has no native frame, and on Linux it is given no controls over the bar: pino draws the three itself and
 * asks main to minimise, maximise or close (`ui/WindowControls.tsx`).
 */
export function frameOptions(_dark: boolean): Pick<BrowserWindowConstructorOptions, 'titleBarStyle'> {
  // The same in both themes: the bar pino draws takes its colours from the tokens.
  return { titleBarStyle: 'hidden' }
}
