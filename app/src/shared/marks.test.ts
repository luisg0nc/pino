import { describe, expect, it } from 'vitest'
import { arrow, point, region, stroke, tiny } from '../test/marks'
import { markLabel, markPayload, MAX_NOTE, MAX_STROKE_POINTS, MOST_AGENT_TARGETS, MOST_MARKS, STROKE_TOLERANCE, withCrossings } from './marks'

describe('the payload Claude gets', () => {
  it('is the exact reference for a point', () => {
    expect(markPayload(point({ target: { kind: 'pad', ref: 'U1', number: '2' } }), tiny, null)).toBe('pad U1.2 · IO · net A · bottom copper · at (4.06, 0.95) mm')
  })

  it('says an arrow with its direction in words', () => {
    expect(markPayload(arrow({ from: { kind: 'part', ref: 'R1' }, fromAt: { x: 3, y: 2 }, to: { x: 3, y: 0.5 } }), tiny, null)).toBe(
      'arrow · from part R1 (3.00, 2.00) to (3.00, 0.50) mm · 1.50 mm down'
    )
    const said = (to: { x: number; y: number }) => markPayload(arrow({ from: null, fromAt: { x: 0, y: 0 }, to }), tiny, null)
    expect(said({ x: -2, y: 0 })).toBe('arrow · from (0.00, 0.00) to (-2.00, 0.00) mm · 2.00 mm left')
    expect(said({ x: 1.5, y: -1.5 })).toBe('arrow · from (0.00, 0.00) to (1.50, -1.50) mm · 2.12 mm, 1.50 right and 1.50 down')
    expect(said({ x: 0, y: 3 })).toContain('3.00 mm up')
  })

  it('says a stroke with its layer, length, path and what it crosses', () => {
    const mark = withCrossings(stroke(), tiny)
    expect(markPayload(mark, tiny, null)).toBe('stroke · top copper · 8.00 mm · path (-2.00, 0.00) (6.00, 0.00) mm · crosses nets A, GND · passes parts R1, U1')
    const clear = withCrossings(stroke({ points: [{ x: -8, y: 2 }, { x: -8, y: -2 }] }), tiny)
    expect(markPayload(clear, tiny, null)).toBe('stroke · top copper · 4.00 mm · path (-8.00, 2.00) (-8.00, -2.00) mm · crosses nothing on that layer')
  })

  it("keeps a long stroke's path short by its ends", () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ x: i / 10, y: 4 }))
    const said = markPayload(stroke({ points }), tiny, null)
    expect(said).toContain('path (0.00, 4.00) ')
    expect(said).toContain(' … ')
    expect(said).toContain('(5.90, 4.00) mm')
    expect(said.match(/\(/g)).toHaveLength(24)
  })

  it('says a region with its intent and what it holds', () => {
    const mark = withCrossings(region({ intent: 'keep-clear' }), tiny)
    expect(markPayload(mark, tiny, null)).toBe('keep this clear: region · both copper layers · x -2.00 to 2.00, y -2.00 to 2.00 mm · 4 points · holds R1')
    expect(markPayload(withCrossings(region({ intent: 'put-here', layers: ['B.Cu'] }), tiny), tiny, null)).toContain('put these here: region · bottom copper · ')
    const empty = withCrossings(region({ points: [{ x: -9, y: 4 }, { x: -7, y: 4 }, { x: -7, y: 3 }] }), tiny)
    expect(markPayload(empty, tiny, null)).toBe('region · both copper layers · x -9.00 to -7.00, y 3.00 to 4.00 mm · 3 points · holds no part')
  })

  it('says where a stale mark was and what is gone', () => {
    const mark = point({ anchor: 'stale', was: { at: { x: 1, y: 2 }, text: 'part R9 · 1k' }, target: { kind: 'part', ref: 'R9' } })
    expect(markPayload(mark, tiny, null)).toBe('part R9 · 1k · stale: part R9 is gone, it was at (1.00, 2.00) mm')
  })

  it("labels the person's marks by id and Claude's by target", () => {
    expect(markLabel(point({ id: 'M7' }))).toBe('M7')
    expect(markLabel(point({ id: 'M8', author: 'agent' }))).toBe('R1')
    expect(markLabel(point({ author: 'agent', target: { kind: 'pad', ref: 'U1', number: '3' } }))).toBe('U1.3')
    expect(markLabel(point({ author: 'agent', target: { kind: 'net', name: 'VBUS' } }))).toBe('VBUS')
    expect(markLabel(point({ author: 'agent', target: { kind: 'track', uuid: 'x' } }))).toBe('track')
    expect(markLabel(arrow({ author: 'agent', fromAt: { x: 0, y: 0 }, to: { x: 0.83, y: 0 } }))).toBe('gap 0.83 mm')
  })

  it('has its limits', () => {
    expect([MAX_NOTE, MAX_STROKE_POINTS, MOST_MARKS, MOST_AGENT_TARGETS, STROKE_TOLERANCE]).toEqual([300, 400, 200, 8, 0.1])
  })
})
