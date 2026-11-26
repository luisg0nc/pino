import { expect, it } from 'vitest'
import { readyLines } from './ready'

it('says the three things pino needs are there', () => {
  expect(readyLines({ claude: true, kernel: '0.2.0', kicad: '10.0.6', problem: null })).toEqual([
    { ok: true, text: 'Claude Code is ready' },
    { ok: true, text: 'KiCad 10.0.6 found, with its libraries' },
    { ok: true, text: "pino's Python environment is ready" }
  ])
})

it('says what is missing, and what to do about it', () => {
  expect(readyLines({ claude: false, kernel: '0.2.0', kicad: null, problem: null })).toEqual([
    { ok: false, text: 'Claude Code was not found: install it, then start pino again' },
    { ok: false, text: 'KiCad was not found: pino needs kicad-cli and the KiCad libraries' },
    { ok: true, text: "pino's Python environment is ready" }
  ])
})

it('says only why the engine did not answer, since nothing else is known of KiCad then', () => {
  expect(readyLines({ claude: true, kernel: null, kicad: null, problem: 'uv was not found' })).toEqual([
    { ok: true, text: 'Claude Code is ready' },
    { ok: false, text: "pino's Python environment did not start: uv was not found" }
  ])
})
