import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { changedItems, type ChangedSet } from '../../shared/board/changes'
import { toKicad } from '../../shared/board/coords'
import type { Board } from '../../shared/board/board'
import type { Pt } from '../../shared/board/geom'
import { hitTest, Index, nextHit, type Hit } from '../../shared/board/hit'
import { centreOf, describeTarget, findTarget, shortLabel, targetOf, type Target } from '../../shared/board/refs'
import { pressed, which } from '../../shared/keys'
import { ratsFor } from '../../shared/view'
import { actions, store, useStore } from '../state/store'
import { registerView } from '../state/testHooks'
import type { ViewModel } from '../state/viewModel'
import { numbered } from '../ui/numbered'
import { Tag } from '../ui/view/Tag'
import { drawBoard, toPaths, type DrawOpts, type View } from './draw'
import { drawTarget, toBoardSpace } from './drawTarget'
import { FindingPins } from './FindingPins'
import { typingIn } from './keysHeard'
import { LayerStack } from './LayerStack'
import { netColourFor } from './netColours'
import { boardColours } from './style'
import { once, sized, useDark, useSize } from './useCanvas'
import { DRAG_SLOP, fit, INSET, scaleBar, toModel, toScreen, zoomAt } from './viewport'

/** How near a click must come to a thing it misses, in px. */
const NEAR = 4
const WHEEL = 1.0015
const WASH_MS = 700

/** Where the person left each project's board: kept across the tabs and across builds, for the run. */
const kept = new Map<string, View>()
/** The board each project's view drew last, to say what a new build changed. */
const lastDrawn = new Map<string, { key: string; board: Board }>()

const NOTHING: ChangedSet = { parts: [], tracks: [], vias: [], zones: [] }

const changedTargets = (c: ChangedSet): Target[] => [
  ...c.parts.map((ref): Target => ({ kind: 'part', ref })),
  ...c.tracks.map((uuid): Target => ({ kind: 'track', uuid })),
  ...c.vias.map((uuid): Target => ({ kind: 'via', uuid }))
]

/** A tag's first line for what is selected: its label, then the first words of its reference that add to it. */
function tagLines(text: string): { head: string; rest: string } {
  const [head, ...rest] = text.split(' · ')
  return { head, rest: rest.join(' · ') }
}

export function BoardView({ model }: { model: ViewModel }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  const size = useSize(root)
  const dark = useDark()
  const look = useStore((s) => s.look)
  const selection = useStore((s) => s.selection)
  const hot = useStore((s) => s.hotFinding)
  const [view, setView] = useState<View | null>(() => kept.get(model.projectId) ?? null)
  const [panning, setPanning] = useState(false)
  /** 0 to 1 while the wash over what changed fades. */
  const [washed, setWashed] = useState(1)
  const press = useRef<{ x: number; y: number; view: View; dragged: boolean } | null>(null)
  const lastClick = useRef<Pt | null>(null)

  const board = model.board
  const scene = useMemo(() => toPaths(board, model.stale), [board, model.stale])
  const index = useMemo(() => new Index(board), [board])
  const rats = useMemo(() => ratsFor(model.placement, model.open), [model.placement, model.open])
  // A layer the board does not have (another project's choice) falls back to the top.
  const active = board.copper.includes(look.active) ? look.active : (board.copper[0] ?? 'F.Cu')

  const [changed, setChanged] = useState<ChangedSet>(NOTHING)
  useEffect(() => {
    const before = lastDrawn.get(model.projectId)
    if (before?.key === model.key) return
    lastDrawn.set(model.projectId, { key: model.key, board })
    const next = changedItems(before?.board ?? null, board)
    setChanged(next)
    if (!changedTargets(next).length) return
    return once(WASH_MS, setWashed)
  }, [model.key, model.projectId, board])

  const refit = useCallback(() => {
    if (size.w && size.h) setView(fit(board.box, size.w, size.h, INSET))
  }, [board, size.w, size.h])
  useEffect(() => {
    if (!view) refit()
  }, [view, refit])
  useEffect(() => {
    if (view) kept.set(model.projectId, view)
  }, [view, model.projectId])

  // ---- the board, drawn when it or the way it is looked at changes
  useEffect(() => {
    const target = canvas.current
    if (!target || !view || !size.w) return
    sized(target, size)
    const colours = boardColours(target)
    const opts: DrawOpts = {
      active,
      layers: board.copper,
      pours: look.pours,
      silk: look.silk,
      ratsnest: look.ratsnest,
      netColours: look.netColours,
      stale: model.stale.size ? { tracks: model.stale } : null,
      dark,
      netColourOf: netColourFor(model.circuit, dark, colours.rat)
    }
    drawBoard(target.getContext('2d')!, scene, view, size.dpr, opts, colours, rats)
  }, [scene, view, size, look, active, dark, rats, model.stale, model.circuit, board])

  // ---- what lies over it: what changed, and what is selected
  useEffect(() => {
    const target = over.current
    if (!target || !view || !size.w) return
    sized(target, size)
    const colours = boardColours(target)
    const ctx = target.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, target.width, target.height)
    const px = toBoardSpace(ctx, view, size.dpr)
    if (washed < 1) {
      // The accent's wash over what a build changed, once.
      ctx.save()
      for (const item of changedTargets(changed)) {
        const found = findTarget(board, item)
        if (!found) continue
        ctx.globalAlpha = 0.55 * (1 - washed)
        ctx.fillStyle = colours.accent
        ctx.beginPath()
        ctx.rect(found.box.x0 - 4 * px, found.box.y0 - 4 * px, found.box.x1 - found.box.x0 + 8 * px, found.box.y1 - found.box.y0 + 8 * px)
        ctx.fill()
      }
      ctx.restore()
    }
    if (selection) {
      drawTarget(ctx, board, selection.target, { colour: colours.accent, paper: colours.paper }, px)
      if (selection.target.kind === 'net' && look.ratsnest) {
        ctx.strokeStyle = colours.accent
        ctx.lineWidth = 1.6 * px
        ctx.setLineDash([4 * px, 3 * px])
        for (const [a, b, net] of rats) {
          if (net !== selection.target.name) continue
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
        ctx.setLineDash([])
      }
    }
  }, [view, size, selection, board, rats, look.ratsnest, washed, changed, dark])

  // ---- the pointer
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const box = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const click = (screen: Pt): void => {
    if (!view) return
    const at = toModel(view, screen)
    const hits: Hit[] = hitTest(index, at, { visible: new Set(board.copper), active, tol: NEAR / view.scale })
    const again = lastClick.current && Math.hypot(lastClick.current.x - screen.x, lastClick.current.y - screen.y) <= DRAG_SLOP
    const held = again && store.getState().selection ? findTarget(board, store.getState().selection!.target) : null
    const hit = nextHit(hits, held)
    lastClick.current = screen
    if (!hit) {
      actions.select(null)
      return
    }
    const target = targetOf(hit, at)
    actions.select({ tab: 'board', target, text: describeTarget(board, model.circuit, target), label: shortLabel(board, target) })
  }

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0 || !view) return
    canvas.current!.setPointerCapture(e.pointerId)
    press.current = { ...local(e), view, dragged: false }
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    const from = press.current
    if (!from) return
    const at = local(e)
    if (!from.dragged && Math.hypot(at.x - from.x, at.y - from.y) <= DRAG_SLOP) return
    from.dragged = true
    setPanning(true)
    setView({ ...from.view, tx: from.view.tx + at.x - from.x, ty: from.view.ty + at.y - from.y })
  }
  const onPointerUp = (e: ReactPointerEvent): void => {
    const from = press.current
    press.current = null
    setPanning(false)
    if (from && !from.dragged) click(local(e))
  }

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    // Not React's: the wheel must be held back from scrolling anything, which a passive listener cannot do.
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const at = local(e)
      setView((v) => v && zoomAt(v, at, WHEEL ** -e.deltaY))
    }
    target.addEventListener('wheel', wheel, { passive: false })
    return () => target.removeEventListener('wheel', wheel)
  }, [])

  // ---- the keys of the view, heard outside fields
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.defaultPrevented) return
      const layer = which(e, 'board.layer')
      if (layer >= 0 && board.copper[layer]) actions.setLook({ active: board.copper[layer] })
      else if (pressed(e, 'board.fit')) refit()
      else if (pressed(e, 'board.nets')) actions.setLook({ netColours: !store.getState().look.netColours })
      else if (pressed(e, 'view.drop') && store.getState().selection) actions.select(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [board, refit])

  useEffect(
    () =>
      registerView('board', {
        screenOf(target) {
          const centre = centreOf(board, target)
          if (!centre || !view) return null
          const box = canvas.current!.getBoundingClientRect()
          const at = toScreen(view, toKicad(centre))
          return { x: at.x + box.left, y: at.y + box.top }
        },
        drawn: () => ({
          hash: model.hash,
          route: model.route,
          layers: board.copper,
          active,
          items: scene.batches.reduce((n, b) => n + b.items.length, 0),
          highlighted: [...changed.parts, ...changed.tracks, ...changed.vias],
          marks: [] as string[],
          stale: model.stale.size
        })
      }),
    [board, view, model, active, scene, changed]
  )

  const onBoard = view ? (p: { x: number; y: number }) => toScreen(view, toKicad(p)) : null
  const selected = selection && view ? centreOf(board, selection.target) : null
  const bar = view ? scaleBar(view.scale) : null
  const words = selection ? tagLines(selection.text) : null
  return (
    <div ref={root} className="board-view" data-panning={panning || undefined}>
      <canvas ref={canvas} className="board" aria-label="The board" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => ((press.current = null), setPanning(false))} />
      <canvas ref={over} className="over" aria-hidden="true" />
      {onBoard && <FindingPins findings={model.result.findings} space="board" place={onBoard} />}
      {words && selected && onBoard && hot === null && (
        <Tag id="selection" subject={onBoard(selected)} prefer="right">
          <p className="tag-head">{numbered(words.head)}</p>
          <p className="tag-more">{words.rest}</p>
        </Tag>
      )}
      <LayerStack board={board} look={{ ...look, active }} />
      {bar && (
        <div className="scale" data-tag-avoid="">
          <i style={{ width: `${bar.px}px` }} />
          {bar.mm} mm
        </div>
      )}
      <p className="hint" data-tag-avoid="">
        Click a part, pad or track · drag pans · scroll zooms
      </p>
    </div>
  )
}
