import { expect, it } from 'vitest'
import { readBoard } from '../../shared/board/board'
import { toKicad } from '../../shared/board/coords'
import { meshBox } from '../../test/glb'
import { fx, read } from '../../test/fixtures'
import { glbFrame } from './glb'

const board = readBoard(read(fx('filled/board.kicad_pcb')))
const pcb = meshBox(fx('board.glb'), 'board_PCB')

it('finds the GLB in metres, with y up, on the page the board file is drawn on', () => {
  const f = glbFrame(board.box, pcb)
  expect(f.scale).toBeCloseTo(0.001, 8)
})

it('maps a board point into the GLB where the board is', () => {
  const f = glbFrame(board.box, pcb)
  const [x, y, z] = f.toGlb(toKicad({ x: 0, y: 0 }))
  expect(x).toBeCloseTo((pcb.min[0] + pcb.max[0]) / 2, 4)
  expect(z).toBeCloseTo((pcb.min[2] + pcb.max[2]) / 2, 4)
  expect(y).toBeCloseTo(pcb.max[1], 6)
})

it('puts a part where its footprint is: KiCad y is the GLB z', () => {
  const f = glbFrame(board.box, pcb)
  const c4 = board.footprints.find((p) => p.ref === 'C4')!
  const [x, , z] = f.toGlb(c4.pos)
  expect(x).toBeCloseTo(0.09805, 5)
  expect(z).toBeCloseTo(0.09745, 5)
})
