// Which model Claude's 3D picture asks after. Drawing it needs WebGL, so the loader is stood in for and stops there.
import { expect, it, vi } from 'vitest'
import type { ViewModel } from '../state/viewModel'
import { threeLook } from './look'

vi.mock('./stage', () => ({ loadModel: () => Promise.reject(new Error('the model is read')) }))

const modelOf = (from: 'build' | 'route', artifacts: Record<string, string>) =>
  ({ result: { number: 4, artifacts }, model3d: { from }, route: null }) as unknown as ViewModel

it("asks whether the build has a model only when the build's is the one loaded", async () => {
  await expect(threeLook(modelOf('build', {}), { tab: '3d' }, 800)).rejects.toThrow('h4 has no 3D model.')
  await expect(threeLook(modelOf('build', { glb: 'board.glb' }), { tab: '3d' }, 800)).rejects.toThrow('the model is read')
  await expect(threeLook(modelOf('route', {}), { tab: '3d' }, 800)).rejects.toThrow('the model is read')
})
