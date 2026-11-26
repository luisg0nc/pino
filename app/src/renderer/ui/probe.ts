// pino's mark, "the probe": a spring test probe touching a pad on a board, seen from the side (the design mocks'
// logo/b-probe). pino's second job is pointing, and a probe is how a board is pointed at. Graphite barrel, collar and
// crowned plunger; the board in solder-mask green under its pad. The launcher's icons (scripts/pino.svg,
// pino-16.svg) are what these shapes draw (probe.test.ts holds them to it).

export type ProbeShape = { fill: 'ink' | 'accent' } & ({ rect: readonly [x: number, y: number, w: number, h: number, r?: number] } | { d: string })

/** The mark on a grid of 64. */
export const TILE_SHAPES: readonly ProbeShape[] = [
  { rect: [6, 52, 52, 6, 1], fill: 'accent' },
  { rect: [22, 49, 20, 3, 0.5], fill: 'ink' },
  { rect: [26, 4, 12, 28, 2], fill: 'ink' },
  { rect: [22, 14, 20, 4, 1], fill: 'ink' },
  { rect: [29, 32, 6, 12], fill: 'ink' },
  { d: 'M27 44h10l-1 4.5-1.7-2.5-1.3 2.5-1-2.5-1 2.5-1.3-2.5-1.7 2.5z', fill: 'ink' }
]

/** Drawn again for 16 px, on whole pixels: the crown is too small to be seen there. */
export const ICON16_SHAPES: readonly ProbeShape[] = [
  { rect: [1, 13, 14, 2], fill: 'accent' },
  { rect: [5, 12, 6, 1], fill: 'ink' },
  { rect: [6, 1, 4, 7], fill: 'ink' },
  { rect: [5, 4, 6, 1], fill: 'ink' },
  { rect: [7, 8, 2, 4], fill: 'ink' }
]

/** The icon as a file: its shapes on a rounded tile, in colours of the caller's. */
export function probeSvg(shapes: readonly ProbeShape[], grid: 16 | 64, colours: { ink: string; accent: string; tile?: string }): string {
  const drawn = shapes.map((s) => {
    const fill = colours[s.fill]
    if ('d' in s) return `<path d="${s.d}" fill="${fill}"/>`
    const [x, y, w, h, r] = s.rect
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r ? ` rx="${r}"` : ''} fill="${fill}"/>`
  })
  const tile = colours.tile ? [`<rect width="${grid}" height="${grid}" rx="${grid === 64 ? 14 : 3.5}" fill="${colours.tile}"/>`] : []
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" width="${grid}" height="${grid}">`, ...[...tile, ...drawn].map((line) => `  ${line}`), '</svg>', ''].join('\n')
}

// ---- the drawing scribed on the first screen's dye

export const SCRIBE_BOX = '0 0 620 420'

/** The probe over its pad and board, line by line. */
export const SCRIBE_PATHS: readonly string[] = [
  'M280 20h60a8 8 0 0 1 8 8v172h-76v-172a8 8 0 0 1 8 -8z',
  'M256 84h108v22h-108z',
  'M292 120h36v54h-36z',
  'M296 128l28 8-28 8 28 8-28 8 28 8',
  'M296 200h28v70h-28z',
  'M290 270h40l-6 26-8-14-6 14-6-14-8 14z',
  'M240 318h140v12h-140z',
  'M74 330h472a4 4 0 0 1 4 4v32a4 4 0 0 1 -4 4h-472a4 4 0 0 1 -4 -4v-32a4 4 0 0 1 4 -4z'
]

/** The board in section: its fill, and the hatching, which is cut at its edges. */
export const PART = { x: 70, y: 330, width: 480, height: 40, radius: 4, hatches: Array.from({ length: 22 }, (_, i) => `M${80 + i * 22} 370l26 -40`) } as const

export const DIMENSIONS: ReadonlyArray<{ text: string; lines: string; x: number; y: number; middle?: true }> = [
  { text: '⌀1.02', lines: 'M296 214h-60M324 214h60M236 214l8-4M236 214l8 4', x: 186, y: 220, middle: true },
  { text: '1.5 travel', lines: 'M420 200v96M412 200h16M412 296h16', x: 440, y: 254 },
  { text: 'pad 1.6', lines: 'M240 396h140M240 386v20M380 386v20', x: 310, y: 418, middle: true }
]
