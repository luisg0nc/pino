import { expect, it } from 'vitest'
import type { Finding } from '../../shared/build'
import { clusterPins, GATHER, positioned } from './pins'

const finding = (x: number | null, y: number, severity: Finding['severity'] = 'warning', message = 'm'): Finding => ({
  source: 'drc',
  code: 'c',
  severity,
  message,
  ...(x === null ? {} : { at: { space: 'board' as const, x, y } })
})

it('numbers the findings that have a place on the board, in the order the engine gives them', () => {
  const found = positioned([finding(1, 1), finding(null, 0), { ...finding(2, 2), at: { space: 'sheet', x: 2, y: 2 } }, finding(3, 3, 'error')], 'board')
  expect(found.map((f) => [f.n, f.index])).toEqual([[1, 0], [2, 3]])
  expect(positioned([{ ...finding(2, 2), at: { space: 'sheet', x: 2, y: 2 } }], 'sheet')).toHaveLength(1)
})

it('gathers pins that would cover one another, under the worst severity among them', () => {
  const pins = positioned([finding(0, 0), finding(0.5, 0), finding(10, 0, 'info'), finding(0.2, 0.3, 'error')], 'board')
  const clusters = clusterPins(pins, (p) => ({ x: p.x * 20, y: p.y * 20 }), 18)
  expect(clusters.map((c) => [c.members.map((m) => m.n), c.severity])).toEqual([
    [[1, 2, 4], 'error'],
    [[3], 'info']
  ])
  expect(clusters[0].at).toEqual({ x: 0, y: 0 })
  // zoomed in, they part
  expect(clusterPins(pins, (p) => ({ x: p.x * 100, y: p.y * 100 }), 18)).toHaveLength(4)
})

// A pin is 18 px across, wider with a count: two a few pixels apart read as one blot.
it('leaves a gap between any two pins on screen', () => {
  const pins = positioned([finding(0, 0), finding(23, 0), finding(60, 0)], 'board')
  expect(clusterPins(pins, (p) => ({ x: p.x, y: p.y }), GATHER).map((c) => c.members.length)).toEqual([2, 1])
})
