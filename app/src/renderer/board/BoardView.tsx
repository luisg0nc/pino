import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { changedItems, type ChangedSet } from '../../shared/board/changes'
import { toKicad } from '../../shared/board/coords'
import type { Board } from '../../shared/board/board'
import type { Pt } from '../../shared/board/geom'
import { hitTest, Index, nextHit, type Hit } from '../../shared/board/hit'
import { centreOf, describeTarget, findTarget, layerWords, shortLabel, targetOf, type Target } from '../../shared/board/refs'
import type { NewMark } from '../../shared/marks'
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
import { ChipLayer } from './marks/ChipLayer'
import { chipAnchor } from './marks/chips'
import { drawArrow, drawMark, drawPen, drawRegion, outlineOfPart } from './marks/drawMarks'
import { MarkReed } from './marks/MarkReed'
import { liveReadout, newMarkFrom, strokeOf, TOOL_KEYS, type MarkTool } from './marks/tools'
import { netColourFor } from './netColours'
import { boardColours } from './style'
import { once, sized, useDark, useSize } from './useCanvas'
import { DRAG_SLOP, fit, INSET, scaleBar, toModel, toScreen, zoomAt } from './viewport'

/** How near a click must come to a thing it misses, in px. */
const NEAR = 4
const WHEEL = 1.0015
const WASH_MS = 700
/** A route that lands is drawn in net by net from the pads out: after half a second, in 1.6 s. */
const REVEAL_MS = 1600
const REVEAL_AFTER_MS = 500

/** Where the person left each project's board: kept across the tabs and across builds, for the run. */
const kept = new Map<string, View>()
/** The board each project's view drew last, to say what a new build changed. */
const lastDrawn = new Map<string, { key: string; board: Board; routed: string | null }>()
/** The route whose copper each project's view drew last (null: none), to see one land. */
const lastRoute = new Map<string, string | null>()

const BOARD_TOOLS: readonly MarkTool[] = ['select', 'point', 'arrow', 'stroke', 'region']

const HINTS: Record<MarkTool, string> = {
  select: 'Click a part, pad or track · drag pans · scroll zooms',
  point: 'Click a part, pad or track to mark it · A arrow · D stroke · R region',
  arrow: 'Drag from what should move to where it should go · Esc puts the tool down',
  stroke: 'Drag along the way you want it routed · Esc puts the tool down',
  region: 'Drag round the area · Esc puts the tool down'
}

/** A drag with a drawing tool under way: what lay under the press, and the pointer's path on the view. */
interface Drawing {
  hit?: Hit
  screen: Pt[]
}

/** Asks main for a mark and takes it in hand; why it would not is said in the status line. */
function make(mark: NewMark): void {
  const id = store.getState().project?.id
  if (!id) return
  void window.pino.marks.add(id, mark).catch((e: Error) => actions.notice(e.message))
}

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
  const tool = useStore((s) => s.tool)
  const marks = useStore((s) => s.marks)
  const heldMark = useStore((s) => s.heldMark)
  const hotMark = useStore((s) => s.hotMark)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const open = useMemo(() => marks.filter((m) => m.status !== 'resolved' || m.id === heldMark), [marks, heldMark])
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

  // ---- a route that lands: its copper is drawn in, then what is still open appears and the pins with it
  /** 0 to 1 while the copper arrives. */
  const [arrived, setArrived] = useState(1)
  const routed = model.result.routing?.state === 'current' ? model.route : null
  useLayoutEffect(() => {
    const before = lastRoute.get(model.projectId)
    lastRoute.set(model.projectId, routed)
    // Copper that was there when the view first drew has not landed.
    if (before === undefined || !routed || before === routed) return
    const stop = once(REVEAL_MS, setArrived, REVEAL_AFTER_MS)
    return () => {
      stop()
      setArrived(1)
    }
  }, [model.projectId, routed])
  const arriving = arrived < 1

  const [changed, setChanged] = useState<ChangedSet>(NOTHING)
  useEffect(() => {
    const before = lastDrawn.get(model.projectId)
    if (before?.key === model.key) return
    lastDrawn.set(model.projectId, { key: model.key, board, routed })
    const next = changedItems(before?.board ?? null, board)
    // New copper is not washed over: a route that lands is drawn in instead.
    if (before && before.routed !== routed) next.tracks = next.vias = []
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
      ratsnest: look.ratsnest && !arriving,
      ...(arriving ? { reveal: arrived } : {}),
      netColours: look.netColours,
      stale: model.stale.size ? { tracks: model.stale } : null,
      dark,
      netColourOf: netColourFor(model.circuit, dark, colours.rat)
    }
    drawBoard(target.getContext('2d')!, scene, view, size.dpr, opts, colours, rats)
  }, [scene, view, size, look, active, dark, rats, model.stale, model.circuit, board, arrived, arriving])

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
    for (const mark of open) drawMark(ctx, board, mark, colours, px)
    // The mark in hand, or pointed at, is drawn once more over the others.
    const lit = open.find((m) => m.id === (hotMark ?? heldMark))
    if (lit) drawMark(ctx, board, lit, colours, 1.25 * px)
    if (drawing && view) {
      const path = strokeOf(drawing.screen, view)
      const first = path[0]
      const last = toModel(view, drawing.screen[drawing.screen.length - 1])
      const pen = { colour: colours.userMark, paper: colours.paper, faint: false }
      if (tool === 'stroke') drawPen(ctx, path, pen, px)
      else if (tool === 'region' && path.length > 1) drawRegion(ctx, path, pen, px)
      else if (tool === 'arrow') {
        const made = newMarkFrom('arrow', { hit: drawing.hit, points: [first, last], layer: active, layers: board.copper }, board)
        if (made?.kind === 'arrow') drawArrow(ctx, toKicad(made.fromAt), last, made.from?.kind === 'part' ? outlineOfPart(board, made.from.ref) : null, pen, px)
      }
    }
  }, [view, size, selection, board, rats, look.ratsnest, washed, changed, dark, open, hotMark, heldMark, drawing, tool, active])

  // ---- the pointer
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const box = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const hitsAt = (screen: Pt, from: View): Hit[] => hitTest(index, toModel(from, screen), { visible: new Set(board.copper), active, tol: NEAR / from.scale })

  const click = (screen: Pt): void => {
    if (!view) return
    const at = toModel(view, screen)
    const hits = hitsAt(screen, view)
    if (tool === 'point') {
      const made = newMarkFrom('point', { hit: hits[0], points: [at], layer: active, layers: board.copper }, board)
      if (made) make(made)
      return
    }
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

  const draws = tool === 'arrow' || tool === 'stroke' || tool === 'region'

  const onPointerDown = (e: ReactPointerEvent): void => {
    // The middle button pans with any tool in hand.
    if ((e.button !== 0 && e.button !== 1) || !view) return
    canvas.current!.setPointerCapture(e.pointerId)
    if (draws && e.button === 0) {
      setDrawing({ hit: hitsAt(local(e), view)[0], screen: [local(e)] })
      return
    }
    press.current = { ...local(e), view, dragged: false }
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    if (drawing) {
      const at = local(e)
      setDrawing((d) => d && { ...d, screen: [...d.screen, at] })
      return
    }
    const from = press.current
    if (!from) return
    const at = local(e)
    if (!from.dragged && Math.hypot(at.x - from.x, at.y - from.y) <= DRAG_SLOP) return
    from.dragged = true
    setPanning(true)
    setView({ ...from.view, tx: from.view.tx + at.x - from.x, ty: from.view.ty + at.y - from.y })
  }
  const onPointerUp = (e: ReactPointerEvent): void => {
    if (drawing && view) {
      const screen = [...drawing.screen, local(e)]
      setDrawing(null)
      // The whole of the pointer's way: an arrow takes its two ends from it.
      const path = screen.map((p) => toModel(view, p))
      const made = newMarkFrom(tool, { hit: drawing.hit, points: tool === 'arrow' ? path : strokeOf(screen, view), layer: active, layers: board.copper }, board)
      if (made) make(made)
      return
    }
    const from = press.current
    press.current = null
    setPanning(false)
    if (from && !from.dragged) click(local(e))
  }

  useEffect(() => {
    // The whole view's, so that the wheel zooms over a chip, a pin or a tag as it does over the drawing.
    const target = root.current
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
      const picked = BOARD_TOOLS.find((t) => pressed(e, TOOL_KEYS[t]))
      if (picked) actions.setTool(picked)
      else if (layer >= 0 && board.copper[layer]) actions.setLook({ active: board.copper[layer] })
      else if (pressed(e, 'board.fit')) refit()
      else if (pressed(e, 'board.nets')) actions.setLook({ netColours: !store.getState().look.netColours })
      else if (pressed(e, 'view.drop')) {
        // Esc puts down what is in hand, the nearest first: a line being drawn, the tool, a mark, the selection.
        const now = store.getState()
        setDrawing(null)
        if (now.tool !== 'select') actions.setTool('select')
        else if (now.heldMark) actions.holdMark(null)
        else if (now.selection) actions.select(null)
        else return
      } else return
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
          revealing: arriving,
          hash: model.hash,
          route: model.route,
          layers: board.copper,
          active,
          items: scene.batches.reduce((n, b) => n + b.items.length, 0),
          highlighted: [...changed.parts, ...changed.tracks, ...changed.vias],
          marks: open.filter((m) => chipAnchor(m, board) !== null).map((m) => m.id),
          stale: model.stale.size
        })
      }),
    [board, view, model, active, scene, changed, open, arriving]
  )

  const onBoard = view ? (p: { x: number; y: number }) => toScreen(view, toKicad(p)) : null
  const pen = drawing && tool === 'stroke' && view && drawing.screen.length > 1 ? drawing.screen[drawing.screen.length - 1] : null
  const selected = selection && view ? centreOf(board, selection.target) : null
  const bar = view ? scaleBar(view.scale) : null
  const words = selection ? tagLines(selection.text) : null
  return (
    <div ref={root} className="board-view" data-panning={panning || undefined} data-tool={tool}>
      <canvas
        ref={canvas}
        className="board"
        aria-label="The board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => ((press.current = null), setDrawing(null), setPanning(false))}
      />
      <canvas ref={over} className="over" aria-hidden="true" />
      <MarkReed tools={BOARD_TOOLS} drawing={drawing !== null} />
      {view && <ChipLayer marks={open} place={(m) => { const at = chipAnchor(m, board); return at && toScreen(view, at) }} />}
      {pen && view && (
        <p className="pen" style={{ transform: `translate(${Math.round(pen.x + 18)}px, ${Math.round(pen.y - 12)}px)` }}>
          {layerWords(active).replace(/^./, (c) => c.toUpperCase())}
          <span className="pen-more">{liveReadout(strokeOf(drawing!.screen, view), board, active)}</span>
        </p>
      )}
      {onBoard && !arriving && <FindingPins findings={model.result.findings} space="board" place={onBoard} />}
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
        {HINTS[tool]}
      </p>
    </div>
  )
}
