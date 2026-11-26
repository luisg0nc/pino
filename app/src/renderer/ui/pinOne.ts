// pino's mark, "pin one": a chip seen from above, eight legs, and its pin-1 dot (the design mocks' logo/e-pin-one).
// Pin 1 is where a chip's pins are counted from and the first thing checked before a board goes out. The body and
// seven legs are graphite; pin 1, the top left leg, is in the accent. The dot is a hole cut in the body, so the mark
// works on any background. The launcher's icons (scripts/pino.svg, pino-16.svg) are what these shapes draw
// (pinOne.test.ts holds them to it).

export type MarkShape = { fill: 'ink' | 'accent' } & ({ rect: readonly [x: number, y: number, w: number, h: number, r?: number] } | { d: string })

/** The mark on a grid of 64. The body's `d` is its outline and the dot, drawn with the even-odd rule. */
export const TILE_SHAPES: readonly MarkShape[] = [
  { d: 'M23 8h18a3 3 0 0 1 3 3v42a3 3 0 0 1 -3 3h-18a3 3 0 0 1 -3 -3v-42a3 3 0 0 1 3 -3zM24 14.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0z', fill: 'ink' },
  { rect: [10, 13, 10, 4, 1], fill: 'accent' },
  { rect: [10, 24, 10, 4, 1], fill: 'ink' },
  { rect: [10, 35, 10, 4, 1], fill: 'ink' },
  { rect: [10, 46, 10, 4, 1], fill: 'ink' },
  { rect: [44, 13, 10, 4, 1], fill: 'ink' },
  { rect: [44, 24, 10, 4, 1], fill: 'ink' },
  { rect: [44, 35, 10, 4, 1], fill: 'ink' },
  { rect: [44, 46, 10, 4, 1], fill: 'ink' }
]

/** Drawn again for 16 px, on whole pixels: the dot is one pixel. */
export const ICON16_SHAPES: readonly MarkShape[] = [
  { d: 'M5 1h6v14h-6zM6 2h1v1h-1z', fill: 'ink' },
  { rect: [2, 3, 3, 1], fill: 'accent' },
  { rect: [2, 6, 3, 1], fill: 'ink' },
  { rect: [2, 9, 3, 1], fill: 'ink' },
  { rect: [2, 12, 3, 1], fill: 'ink' },
  { rect: [11, 3, 3, 1], fill: 'ink' },
  { rect: [11, 6, 3, 1], fill: 'ink' },
  { rect: [11, 9, 3, 1], fill: 'ink' },
  { rect: [11, 12, 3, 1], fill: 'ink' }
]

/** The icon as a file: its shapes on a rounded tile, in colours of the caller's. A path is drawn with the even-odd rule. */
export function markSvg(shapes: readonly MarkShape[], grid: 16 | 64, colours: { ink: string; accent: string; tile?: string }): string {
  const drawn = shapes.map((s) => {
    const fill = colours[s.fill]
    if ('d' in s) return `<path d="${s.d}" fill-rule="evenodd" fill="${fill}"/>`
    const [x, y, w, h, r] = s.rect
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r ? ` rx="${r}"` : ''} fill="${fill}"/>`
  })
  const tile = colours.tile ? [`<rect width="${grid}" height="${grid}" rx="${grid === 64 ? 14 : 3.5}" fill="${colours.tile}"/>`] : []
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" width="${grid}" height="${grid}">`, ...[...tile, ...drawn].map((line) => `  ${line}`), '</svg>', ''].join('\n')
}

// ---- the drawing scribed on the first screen's dye

export const SCRIBE_BOX = '0 0 620 420'

const legY = [100, 180, 260, 340]

/** The chip from above, line by line: the body, the pin-1 circle, then the legs, open where they meet the body. */
export const SCRIBE_PATHS: readonly string[] = [
  'M220 60h180a10 10 0 0 1 10 10v310a10 10 0 0 1 -10 10h-180a10 10 0 0 1 -10 -10v-310a10 10 0 0 1 10 -10z',
  'M234 98a12 12 0 1 0 24 0a12 12 0 1 0 -24 0z',
  ...legY.flatMap((y) => [`M210 ${y - 14}h-66a4 4 0 0 0 -4 4v20a4 4 0 0 0 4 4h66`, `M410 ${y - 14}h66a4 4 0 0 1 4 4v20a4 4 0 0 1 -4 4h-66`])
]

/** Pin 1's leg, filled. */
export const PART = 'M144 86h62a4 4 0 0 1 4 4v20a4 4 0 0 1 -4 4h-62a4 4 0 0 1 -4 -4v-20a4 4 0 0 1 4 -4z'

export const DIMENSIONS: ReadonlyArray<{ text: string; lines: string; x: number; y: number; middle?: true }> = [
  { text: '3.9', lines: 'M210 30h200M210 20v20M410 20v20', x: 310, y: 18, middle: true },
  { text: '1.27', lines: 'M520 180v80M510 180h20M510 260h20', x: 540, y: 226 },
  { text: 'pin 1', lines: 'M140 100h-40l-14 -30', x: 80, y: 62, middle: true }
]
