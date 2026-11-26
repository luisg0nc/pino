import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Pt } from '../../shared/board/geom'
import { describeTarget, shortLabel, type Target } from '../../shared/board/refs'
import { pressed } from '../../shared/keys'
import { sheetOf, type Sheet } from '../../shared/sheet'
import type { View } from '../board/draw'
import { FindingPins } from '../board/FindingPins'
import { typingIn } from '../board/keysHeard'
import { useSize } from '../board/useCanvas'
import { DRAG_SLOP, fit, toModel, toScreen, zoomAt } from '../board/viewport'
import { actions, store, useStore } from '../state/store'
import { registerView } from '../state/testHooks'
import type { ViewModel } from '../state/viewModel'
import { numbered } from '../ui/numbered'
import { Tag } from '../ui/view/Tag'
import { contentBox, inkSvg, netShapes, sheetPlace, sheetTargetAt, sheetWords } from './ink'

const WHEEL = 1.0015
const INSET = { l: 8, r: 8, t: 8, b: 8 }

interface Drawing {
  hash: string
  svg: string
  sheet: Sheet | null
}

const drawings = new Map<string, Promise<Drawing>>()

function readDrawing(model: ViewModel): Promise<Drawing> {
  const key = `${model.projectId}|${model.hash}`
  let held = drawings.get(key)
  if (!held) {
    const file = (name: 'schematic_svg' | 'sheet') => window.pino.build.file(model.projectId, model.hash, name).then(String)
    held = Promise.all([file('schematic_svg'), model.result.artifacts.sheet ? file('sheet').then((t) => sheetOf(JSON.parse(t))) : null]).then(([svg, sheet]) => ({
      hash: model.hash,
      svg: inkSvg(svg),
      sheet
    }))
    drawings.set(key, held)
    held.catch(() => drawings.delete(key))
    while (drawings.size > 4) drawings.delete(drawings.keys().next().value!)
  }
  return held
}

/** Where the person left each project's sheet, and the sheet each project's view drew last. */
const kept = new Map<string, View>()
const lastDrawn = new Map<string, Drawing>()

/** The symbols a build moved or changed: its box moved, or the circuit's changes name it. */
function changedSymbols(before: Drawing | undefined, next: Drawing, changes: readonly string[]): string[] {
  if (!before?.sheet || !next.sheet || before.hash === next.hash) return []
  const was = new Map(before.sheet.symbols.map((s) => [s.ref, s]))
  const words = changes.join(' ')
  return next.sheet.symbols
    .filter((s) => {
      const old = was.get(s.ref)
      return !old || Math.abs(old.x0 - s.x0) > 0.01 || Math.abs(old.y0 - s.y0) > 0.01 || new RegExp(`\\b${s.ref}\\b`).test(words)
    })
    .map((s) => s.ref)
}

const box = (s: Sheet['symbols'][number], pad: number) => ({ x: s.x0 - pad, y: s.y0 - pad, width: s.x1 - s.x0 + 2 * pad, height: s.y1 - s.y0 + 2 * pad, rx: 1.2 })

/** A target drawn over the sheet, in sheet mm: `kind` says how (the selection, or what the pointer is over). */
function Over({ sheet, target, kind }: { sheet: Sheet; target: Target; kind: 'selected' | 'hover' }) {
  if (target.kind === 'net') {
    const { wires, spots, pins } = netShapes(sheet, target.name)
    return (
      <g className={`sheet-net sheet-${kind}`}>
        {wires.map((w) => (
          <line key={`${w.a}-${w.b}`} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} />
        ))}
        {[...pins, ...spots].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={0.55} />
        ))}
      </g>
    )
  }
  if (target.kind !== 'part' && target.kind !== 'pad') return null
  const symbol = sheet.symbols.find((s) => s.ref === target.ref)
  if (!symbol) return null
  const pin = target.kind === 'pad' ? symbol.pins.find((p) => p.number === target.number) : undefined
  return pin ? <circle className={`sheet-pin sheet-${kind}`} cx={pin.x} cy={pin.y} r={1.4} /> : <rect className={`sheet-part sheet-${kind}`} {...box(symbol, 1.6)} />
}

export function SheetView({ model }: { model: ViewModel }) {
  const root = useRef<HTMLDivElement>(null)
  const paper = useRef<HTMLDivElement>(null)
  const ink = useRef<HTMLDivElement>(null)
  const size = useSize(paper)
  const selection = useStore((s) => s.selection)
  const hot = useStore((s) => s.hotFinding)
  const hotBlock = useStore((s) => s.hotBlock)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [view, setView] = useState<View | null>(() => kept.get(model.projectId) ?? null)
  const [hover, setHover] = useState<Target | null>(null)
  const [changed, setChanged] = useState<string[]>([])
  const [panning, setPanning] = useState(false)
  const press = useRef<{ x: number; y: number; view: View; dragged: boolean } | null>(null)

  useEffect(() => {
    let here = true
    void readDrawing(model).then(
      (next) => {
        if (!here) return
        setChanged(changedSymbols(lastDrawn.get(model.projectId), next, model.result.changes.circuit))
        lastDrawn.set(model.projectId, next)
        setDrawing(next)
        setProblem(null)
      },
      (e: Error) => here && setProblem(e.message)
    )
    return () => {
      here = false
    }
  }, [model.hash, model.projectId])

  const sheet = drawing?.sheet ?? null
  const refit = useCallback(() => {
    if (sheet && size.w && size.h) setView(fit(contentBox(sheet), size.w, size.h, INSET))
  }, [sheet, size.w, size.h])
  useEffect(() => {
    if (!view) refit()
  }, [view, refit])
  useEffect(() => {
    if (view) kept.set(model.projectId, view)
  }, [view, model.projectId])

  const viewBox = view && size.w ? `${-view.tx / view.scale} ${-view.ty / view.scale} ${size.w / view.scale} ${size.h / view.scale}` : undefined
  // The export is the browser's to draw; pino only says which part of it is on the paper.
  const html = useMemo(() => ({ __html: drawing?.svg ?? '' }), [drawing])
  useLayoutEffect(() => {
    const svg = ink.current?.querySelector('svg')
    if (!svg || !viewBox) return
    svg.setAttribute('viewBox', viewBox)
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet')
  }, [html, viewBox])

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = paper.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const targetAt = (screen: Pt): Target | null => (sheet && view ? sheetTargetAt(sheet, toModel(view, screen)) : null)

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0 || !view) return
    paper.current!.setPointerCapture(e.pointerId)
    press.current = { ...local(e), view, dragged: false }
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    const from = press.current
    const at = local(e)
    if (!from) {
      const next = targetAt(at)
      setHover((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next))
      return
    }
    if (!from.dragged && Math.hypot(at.x - from.x, at.y - from.y) <= DRAG_SLOP) return
    from.dragged = true
    setPanning(true)
    setView({ ...from.view, tx: from.view.tx + at.x - from.x, ty: from.view.ty + at.y - from.y })
  }
  const onPointerUp = (e: ReactPointerEvent): void => {
    const from = press.current
    press.current = null
    setPanning(false)
    if (!from || from.dragged) return
    const target = targetAt(local(e))
    actions.select(target ? { tab: 'schematic', target, text: describeTarget(model.board, model.circuit, target), label: shortLabel(model.board, target) } : null)
  }

  useEffect(() => {
    const element = paper.current
    if (!element) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const at = local(e)
      setView((v) => v && zoomAt(v, at, WHEEL ** -e.deltaY))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.defaultPrevented) return
      if (pressed(e, 'board.fit')) refit()
      else if (pressed(e, 'view.drop') && store.getState().selection) actions.select(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [refit])

  /** A place on the paper in the view's own pixels, where pins and tags stand. */
  const onView = view
    ? (p: Pt): Pt => {
        const at = toScreen(view, p)
        return { x: at.x + (paper.current?.offsetLeft ?? 0), y: at.y + (paper.current?.offsetTop ?? 0) }
      }
    : null

  useEffect(
    () =>
      registerView('schematic', {
        screenOf(target) {
          const at = sheet && sheetPlace(sheet, target)
          if (!at || !view) return null
          const r = paper.current!.getBoundingClientRect()
          const s = toScreen(view, at)
          return { x: s.x + r.left, y: s.y + r.top }
        },
        drawn: () => {
          const held = store.getState().selection?.target
          return {
            hash: drawing?.hash ?? null,
            symbols: sheet?.symbols.length ?? 0,
            selected: held?.kind === 'part' ? held.ref : held?.kind === 'pad' ? `${held.ref}.${held.number}` : null,
            net: held?.kind === 'net' ? held.name : null,
            highlighted: changed,
            marks: [] as string[]
          }
        }
      }),
    [sheet, view, drawing, changed]
  )

  const litBlock = hotBlock ?? (selection?.target.kind === 'part' || selection?.target.kind === 'pad' ? (model.circuit?.parts.find((p) => p.ref === (selection.target as { ref: string }).ref)?.block ?? null) : null)
  const symbolOf = (ref: string) => sheet?.symbols.find((s) => s.ref === ref)
  const held = selection?.target
  const heldSymbol = held?.kind === 'part' ? symbolOf(held.ref) : undefined
  // A part's tag hangs under its lower right corner, clear of the nets at its sides; a pin's is tied to the pin.
  const tagAt = !sheet || !held ? null : heldSymbol ? { x: heldSymbol.x1 + 1.6, y: heldSymbol.y1 + 1.6 } : sheetPlace(sheet, held)
  const words = held && tagAt ? sheetWords(model.board, model.circuit, held) : null

  return (
    <div ref={root} className="sheet-view" data-panning={panning || undefined}>
      <div
        ref={paper}
        className="sheet-paper"
        data-over={hover ? true : undefined}
        aria-label="The schematic"
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => ((press.current = null), setPanning(false))}
      >
        <div ref={ink} className="sheet-ink" dangerouslySetInnerHTML={html} />
        {sheet && viewBox && (
          <svg className="sheet-over" viewBox={viewBox} preserveAspectRatio="xMinYMin meet" aria-hidden="true">
            {/* Over the picture, which paints its own paper: a wash thin enough to read through. */}
            {sheet.frames.map((f) => litBlock === f.key && <rect key={f.key} className="sheet-block" x={f.x0} y={f.y0} width={f.x1 - f.x0} height={f.y1 - f.y0} rx={2} />)}
            {changed.map((ref) => {
              const s = symbolOf(ref)
              return s && <rect key={`${drawing!.hash}-${ref}`} className="sheet-wash" {...box(s, 1.6)} />
            })}
            {hover && <Over sheet={sheet} target={hover} kind="hover" />}
            {held && <Over sheet={sheet} target={held} kind="selected" />}
          </svg>
        )}
      </div>
      {onView && <FindingPins findings={model.result.findings} space="sheet" place={onView} />}
      {words && tagAt && onView && hot === null && (
        <Tag key={heldSymbol ? 'part' : 'point'} id="selection" subject={onView(tagAt)} prefer={heldSymbol ? 'below' : 'right'}>
          <p className="tag-head">{numbered(words.head)}</p>
          {words.lines.map((line) => (
            <p key={line} className="tag-more">
              {line}
            </p>
          ))}
        </Tag>
      )}
      {problem && (
        <p className="sheet-problem selectable" role="alert">
          The schematic could not be read: {problem}
        </p>
      )}
      <p className="hint" data-tag-avoid="">
        Click a part, pin or wire · drag pans · scroll zooms
      </p>
    </div>
  )
}
