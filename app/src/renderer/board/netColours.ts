// A net's colour on the drawings while net colours are on, by its kind in the circuit: ground takes the ratsnest's grey.

import { netColour } from '../../shared/board/palette'
import type { Circuit } from '../../shared/circuit'

export function netColourFor(circuit: Circuit | null, dark: boolean, ground: string): (net: string) => string | null {
  const kinds = new Map((circuit?.nets ?? []).map((n) => [n.name, n.kind]))
  const of = (kind: string) => (circuit?.nets ?? []).filter((n) => n.kind === kind).map((n) => n.name)
  const signals = of('signal')
  const supplies = of('supply')
  return (net) => {
    const kind = kinds.get(net)
    if (!kind) return null
    return netColour(net, kind, signals, dark, supplies) ?? ground
  }
}
