// Each build's thumbnail: its board drawn as the Board tab draws it, small. Drawn once and kept for the run.

import { useEffect, useState } from 'react'
import { ratsFor } from '../../../shared/view'
import { drawBoard, toPaths } from '../../board/draw'
import { boardColours, lightBoardColours } from '../../board/style'
import { fit } from '../../board/viewport'
import { useDark } from '../../board/useCanvas'
import { loadViewModel, type ViewModel } from '../../state/viewModel'
import { factsOf, type Facts, type StripNode } from './strip'

export const THUMB = { w: 62, h: 44 }
/** The picture on a project's card on the page of projects. */
export const PAGE_THUMB = { w: 240, h: 160 }
const SCALE = 2 // for a sharp picture on a dense screen

const pictures = new Map<string, string>()

/** A board drawn small, as a PNG's data URL: in the dark theme's colours, or in the light ones whatever the theme. */
export function boardPicture(model: ViewModel, size: { w: number; h: number }, dark: boolean): string {
  const canvas = document.createElement('canvas')
  canvas.width = size.w * SCALE
  canvas.height = size.h * SCALE
  const colours = dark ? boardColours(document.documentElement) : lightBoardColours()
  const view = fit(model.board.box, size.w, size.h, { l: 3, r: 3, t: 3, b: 3 })
  drawBoard(
    canvas.getContext('2d')!,
    toPaths(model.board, model.stale),
    view,
    SCALE,
    { active: 'F.Cu', layers: model.board.copper, pours: false, silk: false, ratsnest: true, netColours: false, stale: null, dark },
    colours,
    ratsFor(model.placement, model.open)
  )
  return canvas.toDataURL('image/png')
}

/** The pictures of the nodes that can be drawn, by node id, and what each build's result said of it. */
export function useThumbs(projectId: string | null, nodes: readonly StripNode[], onFacts: (number: number, facts: Facts) => void): ReadonlyMap<string, string> {
  const dark = useDark()
  const [, setDrawn] = useState(0)
  const wanted = nodes.filter((n) => n.pick && n.hash).map((n) => `${n.number}:${n.hash}`).join(',')
  useEffect(() => {
    if (!projectId || !wanted) return
    let here = true
    void (async () => {
      for (const one of wanted.split(',').reverse()) {
        const [number, hash] = one.split(':')
        const key = `${projectId}|${hash}|${dark}`
        if (!here || pictures.has(key)) continue
        try {
          const result = await window.pino.build.result(projectId, hash)
          const model = await loadViewModel(projectId, { ...result, number: Number(number) })
          if (!here) return
          pictures.set(key, boardPicture(model, THUMB, dark))
          onFacts(Number(number), factsOf(result))
          setDrawn((n) => n + 1)
        } catch {
          // A build pruned between the history and now: its node stands without a picture.
        }
      }
    })()
    return () => {
      here = false
    }
  }, [projectId, wanted, dark])
  return new Map(nodes.flatMap((n) => (n.hash && pictures.has(`${projectId}|${n.hash}|${dark}`) ? [[n.id, pictures.get(`${projectId}|${n.hash}|${dark}`)!] as const] : [])))
}
