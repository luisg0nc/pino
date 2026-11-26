import { type FabAsk, LCSC } from './cards'

// The PCB slots of the New project page: what a row of each holds, its caps, the check main and the window both hold
// it to, and the one line it is said in (on its card and in the first prompt).

export const POWER_SOURCES = ['USB-C', 'battery', 'barrel jack', "a host's header", 'other'] as const
export const BUSES = ['I2C', 'SPI', 'UART', 'GPIO', 'USB', 'analog', 'other'] as const

export interface PowerRow {
  source: (typeof POWER_SOURCES)[number]
  /** Which battery; only of a battery. */
  kind: string
  volts: string
  /** The current, when it is known. */
  amps: string
  note: string
}

export interface ConnectionRow {
  /** What plugs in or sits on the board. */
  what: string
  bus: (typeof BUSES)[number]
  connector: string
}

/** A part the person has: an LCSC number, or a module in words. */
export interface PartHad {
  what: string
  note: string
}

export const MAX_POWER = 4
export const MAX_CONNECTIONS = 24
export const MAX_PARTS_HAD = 24
export const MAX_ROW = 120
export const MAX_ROW_NOTE = 300
export const MAX_SHAPE_NOTE = 300
export const MAX_BOARDS = 10_000

export const THICKNESSES = [0.8, 1.0, 1.2, 1.6, 2.0] as const
export const ASSEMBLIES = ['jlc', 'hand', 'mix'] as const
export const DEFAULT_FAB: FabAsk = { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The fields of a row, each folded to one line and held to its cap; or why one is not, by the name it is said with. */
function fields<K extends string>(raw: unknown, caps: Record<K, [max: number, said: string]>): Record<K, string> | string {
  if (!isRecord(raw)) return 'A row is a set of fields.'
  const row = {} as Record<K, string>
  for (const key of Object.keys(caps) as K[]) {
    const [max, said] = caps[key]
    const value = raw[key] ?? ''
    if (typeof value !== 'string') return `${said} is not text.`
    const folded = value.replace(/\s+/g, ' ').trim()
    if (folded.length > max) return `${said} is at most ${max} characters.`
    row[key] = folded
  }
  return row
}

export function checkPower(raw: unknown): PowerRow | string {
  const source = POWER_SOURCES.find((s) => s === (raw as { source?: unknown } | null)?.source)
  if (!source) return `Power comes from one of: ${POWER_SOURCES.join(', ')}.`
  const row = fields(raw, { kind: [MAX_ROW, 'The kind'], volts: [MAX_ROW, 'The voltage'], amps: [MAX_ROW, 'The current'], note: [MAX_ROW_NOTE, 'The note'] })
  if (typeof row === 'string') return row
  return { source, ...row, kind: source === 'battery' ? row.kind : '' }
}

export function checkConnection(raw: unknown): ConnectionRow | string {
  const row = fields(raw, { what: [MAX_ROW, 'What plugs in'], connector: [MAX_ROW, 'The connector'] })
  if (typeof row === 'string') return row
  if (row.what === '') return 'Say what plugs in.'
  const bus = BUSES.find((b) => b === (raw as { bus?: unknown }).bus)
  if (!bus) return `It talks over one of: ${BUSES.join(', ')}.`
  return { what: row.what, bus, connector: row.connector }
}

export function checkPartHad(raw: unknown): PartHad | string {
  const row = fields(raw, { what: [MAX_ROW, 'The part'], note: [MAX_ROW_NOTE, 'The note'] })
  if (typeof row === 'string') return row
  if (row.what === '') return 'Give an LCSC number or name a module.'
  const number = row.what.toUpperCase()
  return { what: LCSC.test(number) ? number : row.what, note: row.note }
}

export function checkFab(raw: unknown): FabAsk | string {
  if (!isRecord(raw)) return 'Say what you ask of the fab.'
  const layers = ([2, 4] as const).find((n) => n === raw.layers)
  if (!layers) return 'A board has 2 or 4 layers here.'
  const thickness = THICKNESSES.find((n) => n === raw.thickness)
  if (!thickness) return `A board is ${THICKNESSES.map((n) => n.toFixed(1)).join(', ')} mm thick here.`
  const assembly = ASSEMBLIES.find((a) => a === raw.assembly)
  if (!assembly) return 'Say who assembles it: JLC, you, or a mix.'
  const { boards } = raw
  if (typeof boards !== 'number' || !Number.isInteger(boards) || boards < 1 || boards > MAX_BOARDS) return `Between 1 and ${MAX_BOARDS.toLocaleString('en-US')} boards.`
  return { layers, thickness, assembly, boards }
}

/** A value with its unit when it is a bare number; as typed otherwise, so that a unit is never said twice. */
const withUnit = (value: string, unit: string): string => (/^\d+(?:[.,]\d+)?$/.test(value) ? `${value} ${unit}` : value)

/** A power source in one line: `USB-C, 5 V, 0.5 A`. */
export function powerText(row: PowerRow): string {
  const source = row.kind === '' ? row.source : `${row.source} (${row.kind})`
  const said = [source, withUnit(row.volts, 'V'), withUnit(row.amps, 'A')].filter((s) => s !== '').join(', ')
  return row.note === '' ? said : `${said}: ${row.note}`
}

/** A connection in one line: `SHT40 sensor over I2C, JST-SH 4-pin`. */
export function connectionText(row: ConnectionRow): string {
  const said = `${row.what} over ${row.bus}`
  return row.connector === '' ? said : `${said}, ${row.connector}`
}
