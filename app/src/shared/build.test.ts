import { describe, expect, it } from 'vitest'
import { fx, readJson } from '../test/fixtures'
import { ARTIFACTS, buildResultOf, REQUIRED_FIELDS, verdictWords, type BuildResult } from './build'
import { circuitOf, placementOf } from './circuit'
import { sheetOf } from './sheet'

const reference = (): BuildResult => buildResultOf(readJson(fx('result.json')))!

describe('the build result', () => {
  it('reads the reference build result and refuses another schema', () => {
    const r = reference()
    expect(r.number).toBe(1)
    expect(r.verdict).not.toBe('failed')
    expect(buildResultOf({ ...r, schema: 'pino.build/2' })).toBeNull()
  })

  it('refuses what lacks a required field or has it in another type', () => {
    const r = reference()
    for (const field of REQUIRED_FIELDS) {
      const without: Record<string, unknown> = { ...r }
      delete without[field]
      expect(buildResultOf(without), field).toBeNull()
    }
    expect(buildResultOf({ ...r, number: '1' })).toBeNull()
    expect(buildResultOf({ ...r, findings: [{ source: 'drc' }] })).toBeNull()
    expect(buildResultOf(null)).toBeNull()
    expect(buildResultOf('{}')).toBeNull()
  })

  it('keeps fields a later engine adds', () => {
    expect(buildResultOf({ ...reference(), later: 7 })).toMatchObject({ later: 7 })
  })

  it('holds every required field of the kernel schema', () => {
    const schema = readJson<{ required: string[] }>('../kernel/schema/build-result-1.schema.json')
    expect([...REQUIRED_FIELDS]).toEqual(schema.required)
  })

  it('names only artifacts the kernel schema has', () => {
    const schema = readJson<{ properties: { artifacts: { properties: Record<string, unknown> } } }>('../kernel/schema/build-result-1.schema.json')
    for (const name of ARTIFACTS) expect(Object.keys(schema.properties.artifacts.properties)).toContain(name)
  })

  it('says the verdict as the route card head does', () => {
    const r = { ...reference(), number: 4, headline: 'On h4: 0 errors, 2 warnings, 18 unrouted' }
    expect(verdictWords(r)).toEqual({ on: 'On h4', rest: '0 errors, 2 warnings, 18 unrouted' })
    expect(verdictWords({ ...r, headline: 'On h4: board.py failed at line 12: invalid syntax' }).rest).toBe('board.py failed at line 12: invalid syntax')
  })
})

describe('the build folder files', () => {
  it('reads the circuit, the placement and the sheet of the fixture', () => {
    const circuit = circuitOf(readJson(fx('circuit.json')))!
    expect(circuit.parts.map((p) => p.ref)).toContain('U2')
    expect(circuit.nets.find((n) => n.name === 'VBUS')!.pins).toContainEqual(['U2', '1'])
    expect(placementOf(readJson(fx('placement.json')))!.edges.length).toBeGreaterThan(0)
    expect(sheetOf(readJson(fx('sheet.json')))!.frames.map((f) => f.key)).toEqual(['usb', 'reg', 'mcu'])
  })

  it('reads nothing out of another file', () => {
    expect(circuitOf({ schema: 'pino.circuit/2' })).toBeNull()
    expect(placementOf({ poses: {} })).toBeNull()
    expect(sheetOf(readJson(fx('circuit.json')))).toBeNull()
  })
})
