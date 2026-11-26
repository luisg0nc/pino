import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { centreOf, describeTarget, shortLabel, type Target } from '../../shared/board/refs'
import { toKicad } from '../../shared/board/coords'
import type { Pt } from '../../shared/board/geom'
import { pressed } from '../../shared/keys'
import type { ViewName } from '../../shared/view'
import { modelNote } from '../../shared/model3d'
import { typingIn } from '../board/keysHeard'
import { outlineOfPart } from '../board/marks/drawMarks'
import { useSize } from '../board/useCanvas'
import { actions, store, useStore } from '../state/store'
import { registerView } from '../state/testHooks'
import type { ViewModel } from '../state/viewModel'
import { numbered } from '../ui/numbered'
import { Compass } from '../ui/view/Compass'
import { Tag } from '../ui/view/Tag'
import { aimKeyLight } from '../viewport/lights'
import { dispose, FOV, framing, FROM, kept, type Loaded, loadModel, makeScene, modelId, type Options, place, show } from './stage'

/** The one scene of a mounted view: what three draws with. Nothing is drawn unless something changed. */
interface Stage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  perspective: THREE.PerspectiveCamera
  ortho: THREE.OrthographicCamera
  controls: OrbitControls
  key: THREE.DirectionalLight
  shadow: THREE.Mesh
  draw(): void
}

export function ThreeView({ model }: { model: ViewModel }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<Stage | null>(null)
  const size = useSize(root)
  const id = modelId(model)
  const routingNow = useStore((s) => Boolean(s.build?.route))
  const note = modelNote(model.model3d, model.route, model.result.routing, model.routeFindings, routingNow)
  const selection = useStore((s) => s.selection)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** A machine whose graphics give no WebGL: there is no stage, and nothing that would move a camera. */
  const [noGl, setNoGl] = useState(false)
  const [options, setOptions] = useState<Options>(() => kept.get(model.projectId)?.options ?? { parts: true, silk: true, bare: false })
  const [ortho, setOrtho] = useState(() => kept.get(model.projectId)?.ortho ?? false)
  const [view, setView] = useState<ViewName | null>(null)
  /** Counts the camera's moves, so that what is tied to the board follows it. */
  const [moved, setMoved] = useState(0)
  const orthoRef = useRef(ortho)
  orthoRef.current = ortho

  const camera = () => (orthoRef.current ? stage.current!.ortho : stage.current!.perspective)

  useEffect(() => {
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, alpha: true, preserveDrawingBuffer: true })
    } catch {
      // Thrown out of an effect it would take the whole window with it.
      setNoGl(true)
      return
    }
    const { scene, key, shadow } = makeScene()
    const perspective = new THREE.PerspectiveCamera(FOV, 1, 0.001, 20)
    const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 40)
    const controls = new OrbitControls(orthoRef.current ? orthographic : perspective, canvas.current!)
    const draw = () => {
      const used = orthoRef.current ? orthographic : perspective
      aimKeyLight(key, used, controls.target)
      renderer.render(scene, used)
    }
    controls.addEventListener('change', () => {
      draw()
      setMoved((n) => n + 1)
    })
    controls.addEventListener('start', () => setView(null))
    stage.current = { renderer, scene, perspective, ortho: orthographic, controls, key, shadow, draw }
    return () => {
      controls.dispose()
      dispose(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      stage.current = null
    }
  }, [])

  useEffect(() => {
    if (!stage.current) return
    let here = true
    let held: Loaded | null = null
    void loadModel(model).then(
      (next) => {
        if (!here || !stage.current) return dispose(next.root)
        held = next
        place(stage.current.scene, stage.current.shadow, next)
        setLoaded(next)
        setProblem(null)
      },
      (e: Error) => here && setProblem(e.message)
    )
    return () => {
      here = false
      if (held && stage.current) {
        stage.current.scene.remove(held.root)
        dispose(held.root)
      }
    }
    // The id says which file: the build's, or a route's. The hash too, which the loaded model is told.
  }, [id, model.hash, model.projectId])

  /** The camera put to look at the whole board from a direction, filling most of the view. */
  const frameBoard = useCallback(
    (from: THREE.Vector3) => {
      const s = stage.current
      if (!s || !loaded || !size.w || !size.h) return
      const aspect = size.w / size.h
      const { target, position, height } = framing(loaded.box, from, aspect)
      s.controls.target.copy(target)
      for (const used of [s.perspective, s.ortho]) used.position.copy(position)
      s.ortho.zoom = 1
      Object.assign(s.ortho, { left: -height * aspect, right: height * aspect, top: height, bottom: -height })
      s.ortho.updateProjectionMatrix()
      s.controls.update()
    },
    [loaded, size.w, size.h]
  )

  const go = (name: ViewName): void => {
    setView(name)
    frameBoard(new THREE.Vector3(...FROM[name]))
  }

  // The canvas takes the view's size; the first board of a project is framed from the corner, or as it was left.
  const framed = useRef(false)
  useEffect(() => {
    const s = stage.current
    if (!s || !size.w || !size.h) return
    s.renderer.setPixelRatio(size.dpr)
    s.renderer.setSize(size.w, size.h, false)
    s.perspective.aspect = size.w / size.h
    s.perspective.updateProjectionMatrix()
    if (loaded && !framed.current) {
      framed.current = true
      const left = kept.get(model.projectId)
      frameBoard(left ? left.position.clone().sub(left.target) : new THREE.Vector3(...FROM.iso))
      if (left) {
        s.controls.target.copy(left.target)
        for (const used of [s.perspective, s.ortho]) used.position.copy(left.position)
        s.ortho.zoom = left.zoom
        s.ortho.updateProjectionMatrix()
        s.controls.update()
      }
    }
    const h = s.ortho.top
    Object.assign(s.ortho, { left: -h * (size.w / size.h), right: h * (size.w / size.h) })
    s.ortho.updateProjectionMatrix()
    s.draw()
    setMoved((n) => n + 1)
  }, [size, loaded, frameBoard, model.projectId])

  useEffect(() => {
    const s = stage.current
    if (!s) return
    const used = ortho ? s.ortho : s.perspective
    const other = ortho ? s.perspective : s.ortho
    used.position.copy(other.position)
    s.controls.object = used
    s.controls.update()
    s.draw()
    setMoved((n) => n + 1)
  }, [ortho])

  // Kept as it moves, so that the tabs, the next build and Claude's picture have the angle the person has.
  useEffect(() => {
    const s = stage.current
    if (s && framed.current) kept.set(model.projectId, { position: camera().position.clone(), target: s.controls.target.clone(), ortho: orthoRef.current, zoom: s.ortho.zoom, options })
  }, [moved, options, model.projectId])

  useEffect(() => {
    if (!loaded) return
    show(loaded.root, options)
    stage.current?.draw()
  }, [loaded, options])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.defaultPrevented) return
      if (pressed(e, 'board.fit') && stage.current) frameBoard(camera().position.clone().sub(stage.current.controls.target))
      else if (pressed(e, 'view.drop') && store.getState().selection) actions.select(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [frameBoard])

  /** Where on the view a point on top of the board is, in the view's pixels; null behind the camera. */
  const project = useCallback(
    (p: Pt): Pt | null => {
      if (!loaded || !stage.current) return null
      const at = new THREE.Vector3(...loaded.frame.toGlb(p)).project(camera())
      return at.z > 1 ? null : { x: ((at.x + 1) / 2) * size.w, y: ((1 - at.y) / 2) * size.h }
    },
    [loaded, size.w, size.h]
  )

  const placeOf = useCallback(
    (target: Target): Pt | null => {
      const centre = centreOf(model.board, target)
      return centre ? project(toKicad(centre)) : null
    },
    [model.board, project]
  )

  /** The rightmost corner of the target's part as it is seen, so that its tag stands beside the part and not on it. */
  const edgeOf = (target: Target & { ref: string }): Pt | null => {
    const corners = outlineOfPart(model.board, target.ref)?.flatMap((p) => project(p) ?? []) ?? []
    return corners.length ? corners.reduce((right, p) => (p.x > right.x ? p : right)) : placeOf(target)
  }

  useEffect(
    () =>
      registerView('3d', {
        screenOf(target) {
          const at = placeOf(target)
          if (!at) return null
          const r = canvas.current!.getBoundingClientRect()
          return { x: at.x + r.left, y: at.y + r.top }
        },
        drawn: () => ({
          hash: loaded?.hash ?? null,
          loaded: loaded !== null && loaded.hash === model.hash && loaded.id === id,
          source: loaded?.source ?? null,
          boardMeshes: loaded?.boardMeshes ?? [],
          meshes: loaded?.meshes ?? 0,
          board: loaded?.board ?? false
        })
      }),
    [loaded, placeOf, model.hash, id]
  )

  const tied = selection && (selection.target.kind === 'part' || selection.target.kind === 'pad') ? selection.target : null
  // `moved` is read so that the tag follows the camera.
  const subject = tied && moved >= 0 ? edgeOf(tied) : null
  const part: Target | null = tied ? { kind: 'part', ref: tied.ref } : null
  const words = part ? describeTarget(model.board, model.circuit, part).split(' · ') : []

  const toggle = (key: keyof Options, label: string) => (
    <button type="button" className="three-option" aria-pressed={options[key]} onClick={() => setOptions((o) => ({ ...o, [key]: !o[key] }))}>
      {label}
    </button>
  )

  return (
    <div ref={root} className="three-view">
      <canvas ref={canvas} aria-label="The board in 3D" />
      {noGl && (
        <p className="three-note selectable" role="alert">
          This machine gives pino no WebGL, which the 3D view needs. The schematic and the board work as usual.
        </p>
      )}
      {!noGl && (
        <>
          <div className="three-options" role="group" aria-label="What is drawn" data-tag-avoid="">
            {toggle('parts', 'Parts')}
            {toggle('silk', 'Silk')}
            {toggle('bare', 'Bare board')}
          </div>
          <Compass on={view} go={go} ortho={ortho} setOrtho={setOrtho} fit={() => frameBoard(camera().position.clone().sub(stage.current!.controls.target))} />
        </>
      )}
      {note && !noGl && (
        <p className="three-copper selectable" role="status" data-tag-avoid="">
          {numbered(note)}
        </p>
      )}
      {subject && part && (
        <Tag id="selection" subject={subject} prefer="right">
          <p className="tag-head">
            {numbered(shortLabel(model.board, part))} <span className="tag-more">{words[1]}</span>
          </p>
          <p className="tag-more">{words.slice(2).join(' · ')}</p>
        </Tag>
      )}
      {!loaded && !problem && !noGl && <p className="three-note">Reading the 3D model.</p>}
      {problem && (
        <p className="three-note selectable" role="alert">
          The 3D model could not be read: {problem}
        </p>
      )}
      {!noGl && (
        <p className="hint" data-tag-avoid="">
          Drag turns, right drag pans, scroll zooms
        </p>
      )}
    </div>
  )
}
