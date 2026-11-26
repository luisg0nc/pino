// The board as a picture for Claude: drawn by the view's own rules on a canvas of its own, so what the person sees
// does not move.

import { lookLayers, lookSaid, lookSize, lookWindow, pixelRatio } from '../../shared/look'
import type { Mark } from '../../shared/marks'
import { ratsFor, type BoardLook, type LookRequest, type LookResult } from '../../shared/view'
import type { ViewModel } from '../state/viewModel'
import { drawBoard, toPaths } from './draw'
import { toBoardSpace } from './drawTarget'
import { chipAnchor, chipBoxes } from './marks/chips'
import { drawMark } from './marks/drawMarks'
import { paintChips } from './marks/paintChips'
import { netColourFor } from './netColours'
import { boardColours } from './style'
import { fit, toScreen } from './viewport'

export function pictureOf(canvas: HTMLCanvasElement, said: string): LookResult {
  return { png: canvas.toDataURL('image/png').slice('data:image/png;base64,'.length), width: canvas.width, height: canvas.height, said }
}

export function boardLook(model: ViewModel, request: LookRequest, size: number, look: BoardLook, marks: readonly Mark[], dark: boolean): LookResult {
  const board = model.board
  const chosen = lookLayers(request.layers, board.copper, board.copper.includes(look.active) ? look.active : board.copper[0])
  if ('error' in chosen) throw new Error(chosen.error)
  const box = request.window ? lookWindow(request.window, 'board') : board.box
  if ('error' in box) throw new Error(box.error)
  const { width, height } = lookSize({ w: box.x1 - box.x0, h: box.y1 - box.y0 }, size)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const dpr = pixelRatio(size)
  const view = fit(box, width / dpr, height / dpr, { l: 24, r: 24, t: 24, b: 24 })
  const colours = boardColours(document.documentElement)
  drawBoard(
    ctx,
    toPaths(board, model.stale),
    view,
    dpr,
    {
      ...chosen,
      pours: look.pours,
      silk: look.silk,
      ratsnest: look.ratsnest,
      netColours: look.netColours,
      stale: model.stale.size ? { tracks: model.stale } : null,
      dark,
      netColourOf: netColourFor(model.circuit, dark, colours.rat)
    },
    colours,
    ratsFor(model.placement, model.open)
  )
  const shown = request.marks === false ? [] : marks.filter((m) => m.status !== 'resolved' && chipAnchor(m, board) !== null)
  if (shown.length) {
    const px = toBoardSpace(ctx, view, dpr)
    for (const mark of shown) drawMark(ctx, board, mark, colours, px)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintChips(
      ctx,
      chipBoxes(shown, (m) => {
        const at = chipAnchor(m, board)
        return at && toScreen(view, at)
      }),
      colours
    )
  }
  // The paper under it all: the drawing leaves what lies outside the board clear.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = colours.paper
  ctx.fillRect(0, 0, width, height)
  return pictureOf(canvas, lookSaid({ tab: 'board', build: model.result.number, ...chosen, window: request.window, marks: shown.length }))
}
