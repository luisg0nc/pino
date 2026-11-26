import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast } from './contrast'

it('is the ratio WCAG gives', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
  expect(contrast('#ffffff', '#ffffff')).toBe(1)
  expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.478, 2)
  expect(contrast('#22252A', '#F1EFEA')).toBeGreaterThan(12)
})

const css = readFileSync(resolve(__dirname, '../renderer/styles/tokens.css'), 'utf8')
const dark = css.indexOf('@media (prefers-color-scheme: dark)')
const tokens = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]))

/** How far apart two colours are in hue, in degrees: 0 to 180. */
function hueApart(a: string, b: string): number {
  const hue = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    const max = Math.max(r, g, bl)
    const span = max - Math.min(r, g, bl)
    if (span === 0) return 0
    const h = max === r ? (g - bl) / span : max === g ? 2 + (bl - r) / span : 4 + (r - g) / span
    return (h * 60 + 360) % 360
  }
  const d = Math.abs(hue(a) - hue(b))
  return Math.min(d, 360 - d)
}

describe.each([['light', tokens(css.slice(0, dark))], ['dark', { ...tokens(css.slice(0, dark)), ...tokens(css.slice(dark)) }]])('%s', (_theme, t) => {
  it('holds text on the new grounds', () => {
    for (const g of ['--raise', '--warn-wash', '--fail-wash']) {
      expect([g, contrast(t['--ink'], t[g]) >= 7]).toEqual([g, true])
      for (const f of ['--muted', '--accent', '--ok', '--warn', '--fail']) expect([f, g, contrast(t[f], t[g]) >= 4.5]).toEqual([f, g, true])
    }
  })
  it('holds text on the accent, the dye and the marks', () => {
    expect(contrast(t['--on-accent'], t['--accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-dye'], t['--dye'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-dye-muted'], t['--dye'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-mark'], t['--user-mark'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-mark'], t['--agent-mark'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--scribe'], t['--dye'])).toBeGreaterThanOrEqual(3)
    expect(contrast(t['--field-edge'], t['--raise'])).toBeGreaterThanOrEqual(3)
  })
  it('holds the round sign on the solid core of its hatch, and the stripes of the hatch apart from what is between them', () => {
    // `.sign-disc[data-sign="-"]`: 2 px stripes of --user-mark, between them it mixed 70 % toward white; the `−` sits on a core of --user-mark.
    expect(contrast(t['--on-mark'], t['--user-mark'])).toBeGreaterThanOrEqual(4.5)
    const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16)
    const pale = '#' + [1, 3, 5].map((at) => Math.round(0.3 * channel(t['--user-mark'], at) + 0.7 * 255).toString(16).padStart(2, '0')).join('')
    expect(contrast(t['--user-mark'], pale)).toBeGreaterThanOrEqual(2)
    // The plus is on solid --agent-mark.
    expect(contrast(t['--on-mark'], t['--agent-mark'])).toBeGreaterThanOrEqual(4.5)
  })
  it('draws the route and the hairline quietly', () => {
    const r = contrast(t['--route'], t['--panel'])
    expect(r).toBeGreaterThanOrEqual(1.15)
    expect(r).toBeLessThanOrEqual(2)
    const h = contrast(t['--hairline'], t['--raise'])
    expect(h).toBeGreaterThanOrEqual(1.15)
    expect(h).toBeLessThanOrEqual(2)
  })
  it('has the dye as the accent\'s hue: the same value in light, a deep blue in dark', () => {
    if (_theme === 'light') expect(t['--dye']).toBe(t['--accent'])
    else expect(t['--dye']).not.toBe(t['--accent'])
  })
  it('reads: ink and muted text on both grounds, the accent on the panel', () => {
    for (const ground of ['--surface', '--panel']) {
      expect(contrast(t['--ink'], t[ground])).toBeGreaterThanOrEqual(7)
      expect(contrast(t['--muted'], t[ground])).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(t['--accent'], t['--panel'])).toBeGreaterThanOrEqual(4.5)
  })
  it('reads wherever a colour is text: the verdicts on both grounds, what is chosen on its wash, the primary button', () => {
    // A verdict is said in words in its colour (the status line, a chip, a card): text, not only a sign.
    for (const name of ['--ok', '--warn', '--fail']) for (const ground of ['--surface', '--panel']) expect([name, ground, contrast(t[name], t[ground]) >= 4.5]).toEqual([name, ground, true])
    // The row that is chosen is the accent on its wash, and ink on it; the primary button --on-accent on the accent.
    expect(contrast(t['--accent'], t['--accent-wash'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--ink'], t['--accent-wash'])).toBeGreaterThanOrEqual(7)
    expect(contrast(t['--on-accent'], t['--accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--accent'], t['--surface'])).toBeGreaterThanOrEqual(4.5)
    // A mark's number is --on-mark on the person's red; the three axes are letters beside their fields.
    expect(contrast(t['--on-mark'], t['--user-mark'])).toBeGreaterThanOrEqual(4.5)
    // The agent's is its own colour on the panel, outlined.
    expect(contrast(t['--agent-mark'], t['--panel'])).toBeGreaterThanOrEqual(4.5)
    for (const name of ['--axis-x', '--axis-y', '--axis-z']) expect([name, contrast(t[name], t['--panel']) >= 4.5]).toEqual([name, true])
  })
  it('keeps the two mark colours for marks: a verdict is a colour of its own, to the eye, in both themes', () => {
    // Not by name only: a failing dimension of the person's has a cross beside a chip in their colour, and the
    // two are told apart. The person's violet is no verdict's hue, so hue does it (60 degrees at least from a
    // failure's red); a verdict near a mark's hue is held in lightness, 1.5:1 at least.
    expect(hueApart(t['--fail'], t['--user-mark'])).toBeGreaterThanOrEqual(60)
    expect(contrast(t['--ok'], t['--agent-mark'])).toBeGreaterThanOrEqual(1.5)
    expect(t['--user-mark']).not.toBe(t['--agent-mark'])
    // Nor is an axis a mark's colour: X is no red pencil, Y no agent's green.
    for (const axis of ['--axis-x', '--axis-y', '--axis-z']) for (const mark of ['--user-mark', '--agent-mark']) expect([axis, mark, t[axis] === t[mark]]).toEqual([axis, mark, false])
  })
  it('reads on the wash of the row that is chosen or pointed at: muted words and the three verdicts', () => {
    for (const name of ['--muted', '--ok', '--warn', '--fail']) expect([name, contrast(t[name], t['--accent-wash']) >= 4.5]).toEqual([name, true])
  })
  it('reads an edit as a diff: ink and the signs on both washes, and the washes are no mark\'s colour and no verdict\'s', () => {
    // Removed lines are struck through in ink beside a "−" in the muted colour; added ones have a "+": the sign and the strike
    // carry the meaning, the wash only groups. A step of the hairline on the panel, and the accent's wash.
    for (const wash of ['--diff-removed-wash', '--diff-added-wash']) {
      expect([wash, contrast(t['--ink'], t[wash]) >= 7]).toEqual([wash, true])
      expect([wash, contrast(t['--muted'], t[wash]) >= 4.5]).toEqual([wash, true])
    }
    expect(t['--diff-added-wash']).toBe(t['--accent-wash'])
    expect(t['--diff-removed-wash']).not.toBe(t['--panel'])
    // The removed wash lies between the panel and the hairline, as a grey: no hue to take for a mark or a verdict.
    const between = contrast(t['--panel'], t['--diff-removed-wash']) < contrast(t['--panel'], t['--hairline'])
    expect(between).toBe(true)
    const chroma = (hex: string): number => Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))) - Math.min(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))
    expect(chroma(t['--diff-removed-wash'])).toBeLessThanOrEqual(16)
    // The added wash is the accent's green, 60 degrees from both mark colours and from a failure. Not from --ok: pino's
    // accent is green, so the accent and a good verdict share a hue, and the "+" says which this is.
    for (const other of ['--user-mark', '--agent-mark', '--fail']) expect([other, hueApart(t['--diff-added-wash'], t[other]) >= 60]).toEqual([other, true])
  })
  it('shows where a list is scrolled to: the thumb of a scrollbar is 3:1 on the panel and on the ground', () => {
    for (const ground of ['--panel', '--surface']) expect([ground, contrast(t['--scroll-thumb'], t[ground]) >= 3]).toEqual([ground, true])
    expect(contrast(t['--scroll-thumb'], t['--panel'])).toBeLessThan(contrast(t['--muted'], t['--panel']))
  })
  it('tells a field from its ground: the edge of an input is 3:1 on the panel and on the ground', () => {
    for (const ground of ['--panel', '--surface']) expect([ground, contrast(t['--field-edge'], t[ground]) >= 3]).toEqual([ground, true])
    expect(t['--field-edge']).not.toBe(t['--hairline'])
  })
  it('keeps the letters of the triad readable on the ground of a picture', () => {
    for (const name of ['--axis-x', '--axis-y', '--axis-z']) expect([name, contrast(t[name], t['--surface']) >= 4.5]).toEqual([name, true])
  })
  it('is no amber on near black: the warning of the dark theme is an ochre', () => {
    if (_theme === 'dark') expect(t['--warn']).toBe('#CBAA6A')
  })
  it('shows its marks and its verdicts on the ground, and keeps its hairlines quiet', () => {
    for (const name of ['--user-mark', '--agent-mark', '--ok', '--warn', '--fail']) expect([name, contrast(t[name], t['--surface']) >= 3]).toEqual([name, true])
    const hairline = contrast(t['--hairline'], t['--surface'])
    expect(hairline).toBeGreaterThanOrEqual(1.15)
    expect(hairline).toBeLessThanOrEqual(2)
  })
})

it('has the light tokens written out where no stylesheet is read, as the stylesheet has them', () => {
  // The window's ground in main.
  const light = tokens(css.slice(0, dark))
  const night = tokens(css.slice(dark))
  const frame = readFileSync(resolve(__dirname, '../main/frame.ts'), 'utf8')
  expect(frame).toContain(`export const SURFACE = { light: '${light['--surface']}', dark: '${night['--surface']}' }`)
  // The redesign's values, as the spec's table has them.
  expect([light['--ink'], light['--muted'], night['--muted'], night['--field-edge']]).toEqual(['#20242B', '#62666D', '#9EA3AA', '#747A82'])
  expect(css).toMatch(/--text-size:\s*13\.5px/)
  expect(css).toMatch(/--text-leading:\s*1\.42/)
})

it("has pino's colours: solder-mask green, Claude Code's orange for Claude's marks, violet for the person's", () => {
  const light = tokens(css.slice(0, dark))
  const night = { ...light, ...tokens(css.slice(dark)) }
  expect([light['--accent'], light['--dye'], light['--agent-mark'], light['--user-mark']]).toEqual(['#17663A', '#17663A', '#C0502B', '#6440C4'])
  expect([night['--accent'], night['--dye'], night['--agent-mark'], night['--user-mark']]).toEqual(['#5CC489', '#123D25', '#D97757', '#A88BFA'])
  const rest = ['--accent-wash', '--on-accent', '--scribe', '--on-dye', '--on-dye-muted', '--diff-added-wash']
  expect(rest.map((name) => light[name])).toEqual(['#E0EEE4', '#FFFFFF', '#7DB892', '#F1F8F3', '#C4E0CC', '#E0EEE4'])
  expect(rest.map((name) => night[name])).toEqual(['#1F3A2A', '#0B1F13', '#4C9A6A', '#E6F4EA', '#A8D4B5', '#1F3A2A'])
})
