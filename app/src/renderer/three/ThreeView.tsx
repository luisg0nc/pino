import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { centreOf, describeTarget, shortLabel, type Target } from '../../shared/board/refs'
import { toKicad } from '../../shared/board/coords'
import type { Pt } from '../../shared/board/geom'
import { pressed } from '../../shared/keys'
import type { ViewName } from '../../shared/view'
import { typingIn } from '../board/keysHeard'
import { useSize } from '../board/useCanvas'
import { actions, store, useStore } from '../state/store'
import { registerView } from '../state/testHooks'
import type { ViewModel } from '../state/viewModel'
import { numbered } from '../ui/numbered'
import { Compass } from '../ui/view/Compass'
import { Tag } from '../ui/view/Tag'
import { aimKeyLight, makeLights } from '../viewport/lights'
import { glbFrame, type GlbFrame } from './glb'
import { restyle } from './material'

const FOV = 30
/** Where the camera looks from for each standard view: a direction from the board's middle (GLB: y up, +z to the front). */
const FROM: Record<ViewName, [number, number, number]> = {
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  front: [0, 0.0001, 1],
  back: [0, 0.0001, -1],
  left: [-1, 0.0001, 0],
  right: [1, 0.0001, 0],
  iso: [0.32, 0.8, 0.62]
}

interface Options {
  parts: boolean
  silk: boolean
  bare: boolean
}

interface Loaded {
  hash: string
  root: THREE.Group
  box: THREE.Box3
  frame: GlbFrame
  meshes: number
  board: boolean
}

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

/** The angle the person left each project's board at. */
const kept = new Map<string, { position: THREE.Vector3; target: THREE.Vector3; ortho: boolean; zoom: number }>()

function dispose(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.dispose()
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
      material.dispose()
    }
  })
}

/** A soft shadow under the board: a dark blur on a flat plane, painted once. */
function softShadow(): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const g = canvas.getContext('2d')!
  g.filter = 'blur(22px)'
  g.fillStyle = 'rgb(0 0 0 / .32)'
  g.fillRect(48, 48, 160, 160)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }))
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/** The GLB read into a group, its meshes told their names in the file, the board in the solder-mask look. */
async function load(model: ViewModel): Promise<Loaded> {
  const bytes = (await window.pino.build.file(model.projectId, model.hash, 'glb')) as Uint8Array
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  const json = gltf.parser.json as { meshes: Array<{ name?: string }> }
  let meshes = 0
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    meshes += 1
    const index = gltf.parser.associations.get(o)?.meshes
    o.userData.meshName = index === undefined ? '' : (json.meshes[index]?.name ?? '')
  })
  restyle(gltf.scene)
  gltf.scene.updateMatrixWorld(true)
  const substrate = new THREE.Box3()
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.kind === 'fr4') substrate.expandByObject(o)
  })
  const board = !substrate.isEmpty()
  const box = board ? substrate : new THREE.Box3().setFromObject(gltf.scene)
  const frame = glbFrame(model.board.box, { min: box.min.toArray(), max: box.max.toArray() })
  return { hash: model.hash, root: gltf.scene, box, frame, meshes, board }
}

export function ThreeView({ model }: { model: ViewModel }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<Stage | null>(null)
  const size = useSize(root)
  const selection = useStore((s) => s.selection)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [options, setOptions] = useState<Options>({ parts: true, silk: true, bare: false })
  const [ortho, setOrtho] = useState(() => kept.get(model.projectId)?.ortho ?? false)
  const [view, setView] = useState<ViewName | null>(null)
  /** Counts the camera's moves, so that what is tied to the board follows it. */
  const [moved, setMoved] = useState(0)
  const orthoRef = useRef(ortho)
  orthoRef.current = ortho

  const camera = () => (orthoRef.current ? stage.current!.ortho : stage.current!.perspective)

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, alpha: true, preserveDrawingBuffer: true })
    const scene = new THREE.Scene()
    const perspective = new THREE.PerspectiveCamera(FOV, 1, 0.001, 20)
    const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 40)
    const { sky, key } = makeLights()
    // Lower than the lights are made for a pale CAD part: a dark green board must read as the green it is.
    sky.intensity = 1.05
    key.intensity = 1.6
    const shadow = softShadow()
    scene.add(sky, key, key.target, shadow)
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
    let here = true
    let held: Loaded | null = null
    void load(model).then(
      (next) => {
        if (!here || !stage.current) return dispose(next.root)
        held = next
        stage.current.scene.add(next.root)
        const middle = next.box.getCenter(new THREE.Vector3())
        const extent = next.box.getSize(new THREE.Vector3())
        stage.current.shadow.position.set(middle.x, next.box.min.y - extent.z * 0.06, middle.z + extent.z * 0.04)
        stage.current.shadow.scale.set(extent.x * 1.7, extent.z * 1.75, 1)
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
    // One file for a build: its hash says which.
  }, [model.hash, model.projectId])

  /** The camera put to look at the whole board from a direction, filling most of the view. */
  const frameBoard = useCallback(
    (from: THREE.Vector3) => {
      const s = stage.current
      if (!s || !loaded || !size.w || !size.h) return
      const sphere = loaded.box.getBoundingSphere(new THREE.Sphere())
      const aspect = size.w / size.h
      const half = THREE.MathUtils.degToRad(FOV / 2)
      const distance = (sphere.radius * 0.98) / Math.sin(Math.atan(Math.tan(half) * Math.min(1, aspect)))
      s.controls.target.copy(sphere.center)
      for (const used of [s.perspective, s.ortho]) used.position.copy(sphere.center).addScaledVector(from.clone().normalize(), distance)
      s.ortho.zoom = 1
      const height = distance * Math.tan(half)
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

  useEffect(() => {
    const s = stage.current
    return () => {
      if (s && framed.current) kept.set(model.projectId, { position: camera().position.clone(), target: s.controls.target.clone(), ortho: orthoRef.current, zoom: s.ortho.zoom })
    }
  }, [model.projectId])

  useEffect(() => {
    if (!loaded) return
    loaded.root.traverse((o) => {
      const kind = o.userData.kind as string | undefined
      if (kind === 'part') o.visible = options.parts && !options.bare
      else if (kind === 'silk') o.visible = options.silk && !options.bare
      // The bare board, before its mask: the copper as it is etched.
      else if (kind === 'mask') o.visible = !options.bare
    })
    stage.current?.draw()
  }, [loaded, options])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.defaultPrevented) return
      if (pressed(e, 'board.fit')) frameBoard(camera().position.clone().sub(stage.current!.controls.target))
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

  useEffect(
    () =>
      registerView('3d', {
        screenOf(target) {
          const at = placeOf(target)
          if (!at) return null
          const r = canvas.current!.getBoundingClientRect()
          return { x: at.x + r.left, y: at.y + r.top }
        },
        drawn: () => ({ hash: loaded?.hash ?? null, loaded: loaded !== null && loaded.hash === model.hash, meshes: loaded?.meshes ?? 0, board: loaded?.board ?? false })
      }),
    [loaded, placeOf, model.hash]
  )

  const tied = selection && (selection.target.kind === 'part' || selection.target.kind === 'pad') ? selection.target : null
  // `moved` is read so that the tag follows the camera.
  const subject = tied && moved >= 0 ? placeOf(tied) : null
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
      <div className="three-options" role="group" aria-label="What is drawn" data-tag-avoid="">
        {toggle('parts', 'Parts')}
        {toggle('silk', 'Silk')}
        {toggle('bare', 'Bare board')}
      </div>
      <Compass on={view} go={go} ortho={ortho} setOrtho={setOrtho} fit={() => frameBoard(camera().position.clone().sub(stage.current!.controls.target))} />
      {subject && part && (
        <Tag id="selection" subject={subject} prefer="right">
          <p className="tag-head">
            {numbered(shortLabel(model.board, part))} <span className="tag-more">{words[1]}</span>
          </p>
          <p className="tag-more">{words.slice(2).join(' · ')}</p>
        </Tag>
      )}
      {!loaded && !problem && <p className="three-note">Reading the 3D model.</p>}
      {problem && (
        <p className="three-note selectable" role="alert">
          The 3D model could not be read: {problem}
        </p>
      )}
      <p className="hint" data-tag-avoid="">
        Drag turns, right drag pans, scroll zooms
      </p>
    </div>
  )
}
