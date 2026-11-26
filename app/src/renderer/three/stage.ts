// What the 3D view and Claude's picture of it share: the model read from its file, the lights and the shadow, the
// standard views, how the camera is framed on a board, and the angle the person left each project's board at.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ViewName } from '../../shared/view'
import type { ViewModel } from '../state/viewModel'
import { makeLights } from '../viewport/lights'
import { glbFrame, type GlbFrame } from './glb'
import { restyle } from './material'

export const FOV = 30
/** Where the camera looks from for each standard view: a direction from the board's middle (GLB: y up, +z to the front). */
export const FROM: Record<ViewName, [number, number, number]> = {
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  front: [0, 0.0001, 1],
  back: [0, 0.0001, -1],
  left: [-1, 0.0001, 0],
  right: [1, 0.0001, 0],
  iso: [0.32, 0.8, 0.62]
}

export interface Options {
  parts: boolean
  silk: boolean
  bare: boolean
}

export interface Angle {
  position: THREE.Vector3
  target: THREE.Vector3
  ortho: boolean
  zoom: number
  options: Options
}

/** The angle the person has, or left, each project's board at. */
export const kept = new Map<string, Angle>()

export interface Loaded {
  hash: string
  root: THREE.Group
  box: THREE.Box3
  frame: GlbFrame
  meshes: number
  board: boolean
}

export function dispose(object: THREE.Object3D): void {
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

export function makeScene(): { scene: THREE.Scene; key: THREE.DirectionalLight; shadow: THREE.Mesh } {
  const scene = new THREE.Scene()
  const { sky, key } = makeLights()
  // Lower than the lights are made for a pale CAD part: a dark green board must read as the green it is.
  sky.intensity = 1.05
  key.intensity = 1.6
  const shadow = softShadow()
  scene.add(sky, key, key.target, shadow)
  return { scene, key, shadow }
}

/** Adds the board to the scene, with its shadow just under it. */
export function place(scene: THREE.Scene, shadow: THREE.Mesh, loaded: Loaded): void {
  scene.add(loaded.root)
  const middle = loaded.box.getCenter(new THREE.Vector3())
  const extent = loaded.box.getSize(new THREE.Vector3())
  shadow.position.set(middle.x, loaded.box.min.y - extent.z * 0.06, middle.z + extent.z * 0.04)
  shadow.scale.set(extent.x * 1.7, extent.z * 1.75, 1)
}

export function show(root: THREE.Object3D, options: Options): void {
  root.traverse((o) => {
    const kind = o.userData.kind as string | undefined
    if (kind === 'part') o.visible = options.parts && !options.bare
    else if (kind === 'silk') o.visible = options.silk && !options.bare
    // The bare board, before its mask: the copper as it is etched.
    else if (kind === 'mask') o.visible = !options.bare
  })
}

/** Where a camera of `aspect` stands to look at the whole board from a direction, and half the ortho view's height. */
export function framing(box: THREE.Box3, from: THREE.Vector3, aspect: number): { target: THREE.Vector3; position: THREE.Vector3; height: number } {
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const half = THREE.MathUtils.degToRad(FOV / 2)
  const distance = (sphere.radius * 0.98) / Math.sin(Math.atan(Math.tan(half) * Math.min(1, aspect)))
  return { target: sphere.center, position: sphere.center.clone().addScaledVector(from.clone().normalize(), distance), height: distance * Math.tan(half) }
}

/** The GLB read into a group, its meshes told their names in the file, the board in the solder-mask look. */
export async function loadModel(model: ViewModel): Promise<Loaded> {
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
