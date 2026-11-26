// Chips painted into a picture, as the view draws them in the page: the mark's id and label on its own colour.

import type { Mark } from '../../../shared/marks'
import type { BoardColours } from '../style'
import type { ChipBox } from './chips'
import { markColour } from './drawMarks'

/** Paints the boxes of `chipBoxes` on a context in the same pixels. A picture names each chip by its id too. */
export function paintChips(ctx: CanvasRenderingContext2D, boxes: ReadonlyArray<ChipBox & { mark: Mark }>, colours: BoardColours): void {
  const face = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  ctx.font = `500 10px ${face}`
  ctx.textBaseline = 'middle'
  for (const { mark, x, y, h } of boxes) {
    const words = mark.label === mark.id ? mark.id : `${mark.id} ${mark.label}`
    const w = ctx.measureText(words).width + 10
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 3)
    ctx.fillStyle = markColour(mark.author, colours)
    ctx.fill()
    ctx.fillStyle = colours.paper
    ctx.fillText(words, x + 5, y + h / 2 + 0.5)
  }
}
