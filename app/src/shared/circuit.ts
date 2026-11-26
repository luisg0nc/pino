// The circuit and the placement as the engine writes them into a build folder (circuit.json, placement.json:
// kernel/src/pino_kernel/circuit.py). pino reads them; it never writes them.

import { isRecord } from './build'

export interface CircuitPin {
  number: string
  name: string
  etype: string
}

export interface CircuitPart {
  ref: string
  value: string
  footprint: string
  symbol: string
  block: string
  /** path, shunt, tap or across: how the sheet draws it. */
  role: string
  dnp: boolean
  lcsc: string
  description?: string
  pins: CircuitPin[]
}

export type NetKind = 'signal' | 'supply' | 'gnd'

export interface CircuitNet {
  name: string
  kind: NetKind
  /** The pins on the net, as [reference, pin number]. */
  pins: Array<[string, string]>
}

export interface CircuitExpect {
  [key: string]: unknown
}

export interface Circuit {
  name: string
  layers: number
  /** The fab profile the board is built for, by name. */
  fab?: string
  parts: CircuitPart[]
  nets: CircuitNet[]
  blocks: Array<{ key: string; title: string; parts: string[] }>
  expects?: CircuitExpect[]
}

const strings = (v: unknown, keys: string[]) => isRecord(v) && keys.every((k) => typeof v[k] === 'string')

export function circuitOf(value: unknown): Circuit | null {
  if (!isRecord(value) || value.schema !== 'pino.circuit/1') return null
  const { parts, nets, blocks } = value
  if (!Array.isArray(parts) || !Array.isArray(nets) || !Array.isArray(blocks)) return null
  const part = (p: unknown) =>
    isRecord(p) && strings(p, ['ref', 'value', 'footprint', 'symbol', 'block', 'role', 'lcsc']) && typeof p.dnp === 'boolean' &&
    Array.isArray(p.pins) && p.pins.every((q) => strings(q, ['number', 'name', 'etype']))
  const net = (n: unknown) =>
    isRecord(n) && strings(n, ['name', 'kind']) && Array.isArray(n.pins) && n.pins.every((q) => Array.isArray(q) && q.length === 2)
  const block = (b: unknown) => isRecord(b) && strings(b, ['key', 'title']) && Array.isArray(b.parts)
  return parts.every(part) && nets.every(net) && blocks.every(block) ? (value as unknown as Circuit) : null
}

/** Where a part was put: board millimetres (outline centre, y up), degrees, and which side. */
export interface Pose {
  x: number
  y: number
  rot: number
  back: boolean
}

/** One line of the ratsnest: its net and its two ends, board millimetres, y up. */
export type RatEdge = [net: string, a: [number, number], b: [number, number], kind: string]

export interface Placement {
  poses: Record<string, Pose>
  edges: RatEdge[]
}

export function placementOf(value: unknown): Placement | null {
  if (!isRecord(value) || !isRecord(value.poses) || !Array.isArray(value.edges)) return null
  const pose = (p: unknown) => isRecord(p) && [p.x, p.y, p.rot].every((n) => typeof n === 'number') && typeof p.back === 'boolean'
  const point = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number')
  const edge = (e: unknown) => Array.isArray(e) && typeof e[0] === 'string' && point(e[1]) && point(e[2])
  return Object.values(value.poses).every(pose) && value.edges.every(edge) ? (value as unknown as Placement) : null
}
