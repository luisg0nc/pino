import { describe, expect, it } from 'vitest'
import { markPayload } from '../../shared/marks'
import { arrow, modelOf, point, region, stroke, tiny, tinyWith } from '../../test/marks'
import { reanchor } from './reanchor'

const moved = tinyWith('(at 100 100)', '(at 101.5 100)')
const track = tiny.tracks[0]
const trackMark = point({ target: { kind: 'track', uuid: track.uuid }, at: { x: -0.48, y: 1.5 }, payload: 'track · top copper · net A · 0.25 mm wide' })
const pad = (number = '1') => point({ target: { kind: 'pad', ref: 'R1', number }, at: { x: -0.48, y: 0 }, payload: markPayload(point({ target: { kind: 'pad', ref: 'R1', number } }), tiny, null) })

describe('finding marks again after a build', () => {
  it('leaves what is where it was, and notes the build it looked in', () => {
    const m = reanchor(pad(), modelOf(tiny))
    expect(m).toMatchObject({ anchor: 'ok', checkedBuild: 2, at: { x: -0.48, y: 0 } })
    expect(m.payload).toBe(pad().payload)
  })

  it('a pad that moved is moved, and its payload redone', () => {
    const m = reanchor(pad(), modelOf(moved))
    expect(m).toMatchObject({ anchor: 'moved', at: { x: 1.02, y: 0 } })
    expect(m.payload).toContain('at (1.02, 0.00) mm')
  })

  it('a track whose uuid is gone is stale where it was', () => {
    const gone = { ...tiny, tracks: tiny.tracks.slice(1) }
    const m = reanchor(trackMark, modelOf(gone))
    expect(m.anchor).toBe('stale')
    expect(m.was!.at).toEqual(trackMark.kind === 'point' ? trackMark.at : null)
    expect(m.payload).toMatch(/· stale: its track is gone, it was at \(-0\.48, 1\.50\) mm$/)
    // a later build leaves what was said of it, and one that has the track again finds it
    const again = reanchor(m, modelOf(gone, { number: 5 }))
    expect(again.payload).toBe(m.payload)
    expect(again.was).toEqual(m.was)
    const back = reanchor(again, modelOf(tiny, { number: 6 }))
    expect(back).toMatchObject({ anchor: 'ok', checkedBuild: 6 })
    expect(back.was).toBeUndefined()
    expect(back.payload).toContain(`uuid ${track.uuid}`)
  })

  it('a renamed part is stale, a net renamed is stale, a resolved mark is left alone', () => {
    const renamed = tinyWith('(property "Reference" "R1"', '(property "Reference" "R7"')
    expect(reanchor(point(), modelOf(renamed)).payload).toContain('stale: part R1 is gone')
    const net = point({ target: { kind: 'net', name: 'A' }, payload: 'net A · 2 pins' })
    expect(reanchor(net, modelOf(tinyWith(/\(net "A"\)/g, '(net "B")')))).toMatchObject({ anchor: 'stale' })
    const done = { ...trackMark, status: 'resolved' as const }
    expect(reanchor(done, modelOf({ ...tiny, tracks: [] }))).toBe(done)
  })

  it('a failed build re-anchors nothing', () => {
    expect(reanchor(trackMark, modelOf({ ...tiny, tracks: [] }, { hash: null, verdict: 'failed' }))).toBe(trackMark)
  })

  it('looks for copper on the routed board while the route is current, not on stale copper', () => {
    const bare = { ...tiny, tracks: [] }
    const routed = { ...modelOf(bare, { routing: { state: 'current' } as never }), routeBoard: tiny }
    expect(reanchor(trackMark, routed).anchor).toBe('ok')
    const stale = { ...modelOf(bare, { routing: { state: 'stale' } as never }), routeBoard: tiny }
    expect(reanchor(trackMark, stale).anchor).toBe('stale')
  })

  it("moves an arrow's tail with its part, and keeps where it points", () => {
    const m = reanchor(arrow(), modelOf(moved))
    expect(m).toMatchObject({ anchor: 'moved', fromAt: { x: 1.5, y: 0 }, to: { x: 0, y: -1.5 } })
    const free = reanchor(arrow({ from: null }), modelOf(moved))
    expect(free.anchor).toBe('ok')
    expect(reanchor(arrow({ from: { kind: 'part', ref: 'R9' } }), modelOf(tiny)).anchor).toBe('stale')
  })

  it('a stroke redoes what it crosses after a part moved under it', () => {
    const mark = stroke({ points: [{ x: 1.2, y: 1 }, { x: 1.2, y: -1 }], crosses: { nets: [], parts: [] } })
    const m = reanchor(mark, modelOf(moved))
    // before the move the path ran past both pads; R1's pad 1 (net A) has moved under it
    expect(reanchor(mark, modelOf(tiny)).kind === 'stroke' && (reanchor(mark, modelOf(tiny)) as typeof mark).crosses.nets).toEqual([])
    expect(m.kind === 'stroke' && m.crosses).toEqual({ nets: ['A'], parts: ['R1'] })
    expect(m.kind === 'stroke' && m.points).toEqual(mark.points)
    expect(m.payload).toContain('crosses nets A')
  })

  it('a region says what it holds now', () => {
    const gone = { ...tiny, footprints: tiny.footprints.filter((f) => f.ref !== 'R1') }
    const m = reanchor(region(), modelOf(gone))
    expect(m.kind === 'region' && m.holds).toEqual([])
    expect(m.payload).toContain('holds no part')
  })
})
