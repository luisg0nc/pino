import type { BrowserWindowConstructorOptions } from 'electron'

// The window's own background, painted before the renderer's first frame.
// Keep equal to --surface in src/renderer/styles/tokens.css (shared/contrast.test.ts holds them to it).
export const SURFACE = { light: '#F1EFEA', dark: '#1A1C1F' }

/** The least the window may be: the card and the dock leave the view room (`styles/layout.css`). */
export const MIN_WINDOW = { width: 1120, height: 700 }

/** The size the window opens at. */
export const WINDOW = { width: 1440, height: 900 }
const MOST = 8192

/**
 * The window's size as it is made: its own, or under test the `1920x1080` the run asks for (PINO_TEST_SIZE). A test's
 * hidden window is made at its size and never resized: once resized with a board drawn, it gives no more pictures.
 */
export function windowSize(isTest: boolean, asked: string | undefined): { width: number; height: number } {
  const said = isTest ? /^(\d+)x(\d+)$/.exec(asked ?? '') : null
  if (!said) return WINDOW
  const [width, height] = [Number(said[1]), Number(said[2])]
  const fits = width >= MIN_WINDOW.width && height >= MIN_WINDOW.height && width <= MOST && height <= MOST
  return fits ? { width, height } : WINDOW
}

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
