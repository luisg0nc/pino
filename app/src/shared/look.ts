// The rules of a picture Claude asks for: its size, which copper it draws, the crop, and the words that say what is in it.

import { toKicad } from './board/coords'
import type { BBox } from './board/geom'
import { layerWords } from './board/refs'
import type { ViewTab } from './view'

type Window = { x0: number; y0: number; x1: number; y1: number }

/** The size of a picture of something w by h: `long` px on the long edge, never thinner than one to two. */
export function lookSize(box: { w: number; h: number }, long: number): { width: number; height: number } {
  const aspect = Math.min(2, Math.max(0.5, box.w / box.h || 1))
  return aspect >= 1 ? { width: long, height: Math.round(long / aspect) } : { width: Math.round(long * aspect), height: long }
}

/** A picture is drawn as a screen about this wide would be, so that its lines and chips read. */
const DRAWN_AS = 960

/** The picture's pixels to one pixel of the drawing: more in a large picture, never less than on screen. */
export const pixelRatio = (long: number): number => Math.max(1, long / DRAWN_AS)

/** The copper layers drawn and the one on top: the first Claude names, else the one the person has in front. */
export function lookLayers(wanted: readonly string[] | undefined, copper: readonly string[], active: string): { layers: string[]; active: string } | { error: string } {
  if (!wanted?.length) return { layers: [...copper], active }
  const unknown = wanted.find((l) => !copper.includes(l))
  if (unknown) return { error: `This board has no copper layer ${unknown}. It has ${copper.join(', ')}.` }
  return { layers: [...wanted], active: wanted[0] }
}

/** The crop as a box of what is drawn: the board file (y down) from board mm (y up), or the sheet's own mm. */
export function lookWindow(w: Window, space: 'board' | 'schematic'): BBox | { error: string } {
  if (w.x0 === w.x1 || w.y0 === w.y1) return { error: 'The window has no area: give two corners that differ in x and in y.' }
  const corners = [
    { x: w.x0, y: w.y0 },
    { x: w.x1, y: w.y1 }
  ].map((p) => (space === 'board' ? toKicad(p) : p))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

const TABS: Record<ViewTab, string> = { schematic: 'Schematic', board: 'Board', '3d': '3D' }

export interface LookFacts {
  tab: ViewTab
  /** The build's number. */
  build: number
  layers?: readonly string[]
  active?: string
  window?: Window
  /** How many marks are drawn; null where the view draws none. */
  marks: number | null
}

/** What is in a picture: "Board tab, h7, top copper over bottom, window x -10 to 10, y -5 to 5 mm, 3 marks drawn". */
export function lookSaid(f: LookFacts): string {
  const said = [`${TABS[f.tab]} tab`, `h${f.build}`]
  if (f.tab === '3d') return `${said.join(', ')}, from the angle the person left it at or a corner; marks are not drawn in 3D`
  if (f.tab === 'board' && f.active) {
    const under = (f.layers ?? []).filter((l) => l !== f.active)
    const word = (l: string) => layerWords(l).replace(/ copper$/, '')
    said.push(under.length ? `${layerWords(f.active)} over ${under.map(word).join(' and ')}` : `${layerWords(f.active)} only`)
  }
  const span = (a: number, b: number) => `${Math.min(a, b)} to ${Math.max(a, b)}`
  said.push(f.window ? `window x ${span(f.window.x0, f.window.x1)}, y ${span(f.window.y0, f.window.y1)} mm` : `the whole ${f.tab === 'board' ? 'board' : 'sheet'}`)
  const marks = f.marks ?? 0
  said.push(marks === 0 ? 'no marks drawn' : `${marks} mark${marks === 1 ? '' : 's'} drawn`)
  return said.join(', ')
}
