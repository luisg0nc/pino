// The 3D view as a picture for Claude: the model drawn once by a renderer of its own, from the angle the person has
// or left (else a corner), then let go with its GL context.

import * as THREE from 'three'
import { lookSaid, lookSize } from '../../shared/look'
import { modelNote } from '../../shared/model3d'
import type { LookRequest, LookResult } from '../../shared/view'
import { pictureOf } from '../board/look'
import { store } from '../state/store'
import type { ViewModel } from '../state/viewModel'
import { aimKeyLight } from '../viewport/lights'
import { dispose, FOV, framing, FROM, kept, loadModel, makeScene, place, show } from './stage'

/** The picture's shape when no view says one. */
const SHAPE = { w: 4, h: 3 }

export async function threeLook(model: ViewModel, request: LookRequest, size: number): Promise<LookResult> {
  if (request.window) throw new Error('A window crops the board or the sheet, not the 3D view.')
  if (model.model3d.from === 'build' && !model.result.artifacts.glb) throw new Error(`h${model.result.number} has no 3D model.`)
  const loaded = await loadModel(model)
  const { scene, key, shadow } = makeScene()
  place(scene, shadow, loaded)
  const { width, height } = lookSize(SHAPE, size)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  try {
    renderer.setSize(width, height, false)
    const angle = kept.get(model.projectId)
    if (angle) show(loaded.root, angle.options)
    const from = angle ? angle.position.clone().sub(angle.target) : new THREE.Vector3(...FROM.iso)
    const framed = framing(loaded.box, from, width / height)
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
    if (angle?.ortho) {
      const h = framed.height
      camera = new THREE.OrthographicCamera((-h * width) / height, (h * width) / height, h, -h, -20, 40)
      camera.zoom = angle.zoom
    } else camera = new THREE.PerspectiveCamera(FOV, width / height, 0.001, 20)
    const target = angle?.target ?? framed.target
    camera.position.copy(angle?.position ?? framed.position)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    aimKeyLight(key, camera, target)
    renderer.render(scene, camera)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--board-paper').trim()
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(renderer.domElement, 0, 0, width, height)
    // What the 3D view would say under its switches, Claude is told too.
    const said = [lookSaid({ tab: '3d', build: model.result.number, marks: null }), modelNote(model.model3d, model.route, model.result.routing, model.routeFindings, Boolean(store.getState().build?.route))]
    return pictureOf(canvas, said.filter(Boolean).join(' '))
  } finally {
    dispose(scene)
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
