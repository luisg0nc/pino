// The sheet as a picture for Claude: the inked export drawn through an image on a canvas of its own, with the marks
// over it. A picture reads no stylesheet of the page's, so each token is written out as the theme has it now.

import { lookSaid, lookSize, lookWindow, pixelRatio } from '../../shared/look'
import type { Mark, PointMark } from '../../shared/marks'
import type { Sheet } from '../../shared/sheet'
import type { LookRequest, LookResult } from '../../shared/view'
import { pictureOf } from '../board/look'
import { chipBoxes } from '../board/marks/chips'
import { markColour } from '../board/marks/drawMarks'
import { paintChips } from '../board/marks/paintChips'
import { boardColours } from '../board/style'
import { fit, toScreen } from '../board/viewport'
import type { ViewModel } from '../state/viewModel'
import { readDrawing } from './drawing'
import { contentBox, netShapes, sheetChipAt, sheetMarks, viewBoxOf } from './ink'

async function imageOf(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A mark's shape on the sheet, in sheet mm: a ring round a part or a pin, a net's wires and points lit. */
function drawSheetMark(ctx: CanvasRenderingContext2D, sheet: Sheet, mark: PointMark, colour: string): void {
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  const target = mark.target
  if (target.kind === 'net') {
    const { wires, spots, pins } = netShapes(sheet, target.name)
    ctx.lineWidth = 0.5
    ctx.beginPath()
    for (const w of wires) {
      ctx.moveTo(w.a[0], w.a[1])
      ctx.lineTo(w.b[0], w.b[1])
    }
    ctx.stroke()
    for (const p of [...pins, ...spots]) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 0.55, 0, 2 * Math.PI)
      ctx.fill()
    }
    return
  }
  if (target.kind !== 'part' && target.kind !== 'pad') return
  const symbol = sheet.symbols.find((s) => s.ref === target.ref)
  if (!symbol) return
  const pin = target.kind === 'pad' ? symbol.pins.find((p) => p.number === target.number) : undefined
  ctx.lineWidth = 0.5
  ctx.beginPath()
  if (pin) ctx.arc(pin.x, pin.y, 1.4, 0, 2 * Math.PI)
  else ctx.roundRect(symbol.x0 - 1.6, symbol.y0 - 1.6, symbol.x1 - symbol.x0 + 3.2, symbol.y1 - symbol.y0 + 3.2, 1.2)
  ctx.stroke()
}

export async function sheetLook(model: ViewModel, request: LookRequest, size: number, marks: readonly Mark[]): Promise<LookResult> {
  const drawing = await readDrawing(model)
  const sheet = drawing.sheet
  const [x, y, w, h] = viewBoxOf(drawing.svg)
  const box = request.window ? lookWindow(request.window, 'schematic') : sheet ? contentBox(sheet) : { x0: x, y0: y, x1: x + w, y1: y + h }
  if ('error' in box) throw new Error(box.error)
  const { width, height } = lookSize({ w: box.x1 - box.x0, h: box.y1 - box.y0 }, size)
  const dpr = pixelRatio(size)
  const view = fit(box, width / dpr, height / dpr, { l: 8, r: 8, t: 8, b: 8 })
  const scale = view.scale * dpr

  const root = getComputedStyle(document.documentElement)
  const [left, top] = [-view.tx / view.scale, -view.ty / view.scale]
  const svg = drawing.svg
    .replace(/var\((--[\w-]+)\)/g, (_, name: string) => root.getPropertyValue(name).trim())
    .replace(/^<svg\b[^>]*>/, (open) =>
      open
        .replace(/viewBox\s*=\s*"[^"]*"/, `viewBox="${left} ${top} ${width / scale} ${height / scale}"`)
        .replace(' width="100%" height="100%"', ` width="${width}" height="${height}"`)
    )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = root.getPropertyValue('--sch-paper').trim()
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(await imageOf(svg), 0, 0, width, height)

  const shown = request.marks === false || !sheet ? [] : sheetMarks(sheet, marks)
  if (sheet && shown.length) {
    const colours = boardColours(document.documentElement)
    ctx.setTransform(scale, 0, 0, scale, view.tx * dpr, view.ty * dpr)
    for (const mark of shown) drawSheetMark(ctx, sheet, mark, markColour(mark.author, colours))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintChips(
      ctx,
      chipBoxes(shown, (m) => {
        const at = sheetChipAt(sheet, m)
        return at && toScreen(view, at)
      }),
      colours
    )
  }
  return pictureOf(canvas, lookSaid({ tab: 'schematic', build: model.result.number, window: request.window, marks: shown.length }))
}
